/**
 * PostgreSQL database connector
 * @module dsh-ontology/ingest/connectors/postgres
 */

import type { Client, ClientConfig } from 'pg'
import type { DbConnector } from './base.ts'
import type {
  ColumnInfo,
  ConnectionConfig,
  ForeignKeyInfo,
  TableMetadata,
} from '../types.ts'

/** What a driver module is loaded through. */
type PgModule = typeof import('pg')

/**
 * Load `pg` on demand.
 *
 * It is an optional peer dependency, and this plugin is imported by every
 * profile that lists it — so a static import would make a PostgreSQL driver
 * mandatory for someone who only ever wanted the core tools. Loading it at
 * connect time keeps the dependency honest: absent until the tool is used,
 * and reported as an install instruction rather than a boot crash.
 * @returns the driver module.
 */
async function loadDriver(): Promise<PgModule> {
  try {
    return await import('pg')
  } catch (cause) {
    throw new Error(
      'The PostgreSQL driver is not installed. Add it with `pnpm add pg` '
      + 'to use ontology_ingest_db against PostgreSQL.',
      { cause },
    )
  }
}

export class PostgresConnector implements DbConnector {
  private client: Client | null = null

  constructor(private config: ConnectionConfig) {
    if (config.type !== 'postgres') {
      throw new Error(`Invalid config type: expected 'postgres', got '${config.type}'`)
    }
  }

  async connect(): Promise<void> {
    const pg = await loadDriver()
    // `pg` is CJS: Node hoists its named exports onto the namespace, but fall
    // back to the module object if a future interop stops doing so.
    const PgClient = pg.Client
      ?? (pg as unknown as { default?: PgModule }).default?.Client
    if (PgClient === undefined) {
      throw new Error('the `pg` package did not export Client')
    }

    const options: ClientConfig = {
      host: this.config.host,
      port: this.config.port ?? 5432,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl,
      connectionTimeoutMillis: this.config.connectionTimeout ?? 10000,
    }

    this.client = new PgClient(options)
    await this.client.connect()
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end()
      this.client = null
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.client) throw new Error('Not connected')
    const result = await this.client.query(sql, params)
    return result.rows as T[]
  }

  async getTables(): Promise<string[]> {
    const rows = await this.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)
    return rows.map(r => r.table_name)
  }

  async getColumns(table: string): Promise<ColumnInfo[]> {
    const rows = await this.query<{
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `, [table])

    const pkRows = await this.query<{ column_name: string }>(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'PRIMARY KEY'
    `, [table])

    const pkColumns = new Set(pkRows.map(r => r.column_name))

    return rows.map(r => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
      isPrimaryKey: pkColumns.has(r.column_name),
      defaultValue: r.column_default,
    }))
  }

  async getForeignKeys(table: string): Promise<ForeignKeyInfo[]> {
    const rows = await this.query<{
      constraint_name: string
      column_name: string
      referenced_table: string
      referenced_column: string
    }>(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'FOREIGN KEY'
    `, [table])

    return rows.map(r => ({
      column: r.column_name,
      referencedTable: r.referenced_table,
      referencedColumn: r.referenced_column,
      constraintName: r.constraint_name,
    }))
  }

  async getTableMetadata(table: string): Promise<TableMetadata> {
    const columns = await this.getColumns(table)
    const foreignKeys = await this.getForeignKeys(table)

    return {
      name: table,
      columns: new Map(columns.map(c => [c.name, c])),
      primaryKey: columns.filter(c => c.isPrimaryKey).map(c => c.name),
      foreignKeys,
    }
  }

  async fetchRows(table: string, options: {
    where?: string
    limit?: number
    offset?: number
    orderBy?: string
  }): Promise<any[]> {
    const parts = [`SELECT * FROM ${table}`]

    if (options.where) {
      parts.push(`WHERE ${options.where}`)
    }

    if (options.orderBy) {
      parts.push(`ORDER BY ${options.orderBy}`)
    }

    if (options.limit !== undefined) {
      parts.push(`LIMIT ${options.limit}`)
    }

    if (options.offset !== undefined) {
      parts.push(`OFFSET ${options.offset}`)
    }

    const sql = parts.join(' ')
    return this.query(sql)
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }
}
