/**
 * Abstract database connector interface
 * @module dsh-ontology/ingest/connectors/base
 */

import type {
  ColumnInfo,
  ConnectionConfig,
  ForeignKeyInfo,
  TableMetadata,
} from '../types.ts'

export interface DbConnector {
  /** 建立连接 */
  connect(): Promise<void>

  /** 关闭连接 */
  close(): Promise<void>

  /** 执行查询 */
  query<T = any>(sql: string, params?: any[]): Promise<T[]>

  /** 获取所有表名 */
  getTables(): Promise<string[]>

  /** 获取表的列信息 */
  getColumns(table: string): Promise<ColumnInfo[]>

  /** 获取表的外键信息 */
  getForeignKeys(table: string): Promise<ForeignKeyInfo[]>

  /** 获取表的完整元数据 */
  getTableMetadata(table: string): Promise<TableMetadata>

  /** 查询表数据（支持分页） */
  fetchRows(table: string, options: {
    where?: string
    limit?: number
    offset?: number
    orderBy?: string
  }): Promise<any[]>

  /** 测试连接是否正常 */
  ping(): Promise<boolean>
}

/** 连接器工厂函数类型 */
export type ConnectorFactory = (config: ConnectionConfig) => DbConnector
