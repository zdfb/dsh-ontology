/**
 * MySQL database connector
 * @module dsh-ontology/ingest/connectors/mysql
 */

import type { Connection } from 'mysql2/promise'
import type { DbConnector } from './base.ts'
import type {
  ColumnInfo,
  ConnectionConfig,
  ForeignKeyInfo,
  TableMetadata,
} from '../types.ts'

/** What a driver module is loaded through. */
type MysqlModule = typeof import('mysql2/promise')

/**
 * Load `mysql2` on demand.
 *
 * It is an optional peer dependency, so it must not be pulled in by a plugin
 * that is imported by every profile. See the PostgreSQL connector for the
 * same reasoning.
 * @returns the driver module.
 */
async function loadDriver(): Promise<MysqlModule> {
  try {
    return await import('mysql2/promise')
  } catch (cause) {
    throw new Error(
      'The MySQL driver is not installed. Add it with `pnpm add mysql2` '
      + 'to use ontology_ingest_db against MySQL.',
      { cause },
    )
  }
}

export class MySQLConnector implements DbConnector {
  private connection: Connection | null = null

  constructor(private config: ConnectionConfig) {
    if (config.type !== 'mysql') {
      throw new Error(`Invalid config type: expected 'mysql', got '${config.type}'`)
    }
  }

  async connect(): Promise<void> {
    const mysql = await loadDriver()
    // See the PostgreSQL connector: prefer the hoisted named export, fall
    // back to the module object.
    const createConnection = mysql.createConnection
      ?? (mysql as unknown as { default?: MysqlModule }).default?.createConnection
    if (createConnection === undefined) {
      throw new Error('the `mysql2/promise` package did not export createConnection')
    }

    this.connection = await createConnection({
      host: this.config.host,
      port: this.config.port ?? 3306,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl === true ? {} : (this.config.ssl || undefined),
      connectTimeout: this.config.connectionTimeout ?? 10000,
      // A server whose defaults are latin1 would otherwise mangle non-ASCII
      // labels on the way in, with no error.
      charset: 'utf8mb4',
    })
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.end()
      this.connection = null
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.connection) throw new Error('Not connected')
    const [rows] = await this.connection.execute(sql, params)
    return rows as T[]
  }

  async getTables(): Promise<string[]> {
    const rows = await this.query<{ TABLE_NAME: string }>(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `)
    return rows.map(r => r.TABLE_NAME)
  }

  async getColumns(table: string): Promise<ColumnInfo[]> {
    const rows = await this.query<{
      COLUMN_NAME: string
      DATA_TYPE: string
      IS_NULLABLE: string
      COLUMN_KEY: string
      COLUMN_DEFAULT: string | null
    }>(`
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_KEY,
        COLUMN_DEFAULT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [table])

    return rows.map(r => ({
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      nullable: r.IS_NULLABLE === 'YES',
      isPrimaryKey: r.COLUMN_KEY === 'PRI',
      defaultValue: r.COLUMN_DEFAULT,
    }))
  }

  async getForeignKeys(table: string): Promise<ForeignKeyInfo[]> {
    const rows = await this.query<{
      CONSTRAINT_NAME: string
      COLUMN_NAME: string
      REFERENCED_TABLE_NAME: string
      REFERENCED_COLUMN_NAME: string
    }>(`
      SELECT
        CONSTRAINT_NAME,
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `, [table])

    return rows.map(r => ({
      column: r.COLUMN_NAME,
      referencedTable: r.REFERENCED_TABLE_NAME,
      referencedColumn: r.REFERENCED_COLUMN_NAME,
      constraintName: r.CONSTRAINT_NAME,
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
