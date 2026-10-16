/**
 * Validation logic for mapping configuration
 * @module dsh-ontology/ingest/validator
 */

import type { DbConnector } from './connectors/base.ts'
import type { TableMapping, MappingConfig, IngestError } from './types.ts'

export interface ValidationResult {
  valid: boolean
  errors: IngestError[]
}

/**
 * Validate mapping configuration against database schema
 */
export async function validateMapping(
  connector: DbConnector,
  config: MappingConfig,
): Promise<ValidationResult> {
  const errors: IngestError[] = []

  for (const mapping of config.tables) {
    try {
      // Check if table exists
      const tables = await connector.getTables()
      if (!tables.includes(mapping.table)) {
        errors.push({
          table: mapping.table,
          type: 'validation',
          message: `Table '${mapping.table}' does not exist`,
        })
        continue
      }

      // Get table metadata
      const metadata = await connector.getTableMetadata(mapping.table)

      // Validate ID column
      if (!metadata.columns.has(mapping.idColumn)) {
        errors.push({
          table: mapping.table,
          type: 'validation',
          message: `ID column '${mapping.idColumn}' does not exist in table '${mapping.table}'`,
        })
      } else {
        const idCol = metadata.columns.get(mapping.idColumn)!
        if (!idCol.isPrimaryKey) {
          errors.push({
            table: mapping.table,
            type: 'validation',
            message: `Column '${mapping.idColumn}' is not a primary key in table '${mapping.table}'`,
          })
        }
      }

      // Validate label column
      if (mapping.labelColumn && !metadata.columns.has(mapping.labelColumn)) {
        errors.push({
          table: mapping.table,
          type: 'validation',
          message: `Label column '${mapping.labelColumn}' does not exist in table '${mapping.table}'`,
        })
      }

      // Validate comment column
      if (mapping.commentColumn && !metadata.columns.has(mapping.commentColumn)) {
        errors.push({
          table: mapping.table,
          type: 'validation',
          message: `Comment column '${mapping.commentColumn}' does not exist in table '${mapping.table}'`,
        })
      }

      // Validate attribute columns
      if (mapping.attributes) {
        for (const attr of mapping.attributes) {
          if (!metadata.columns.has(attr.column)) {
            errors.push({
              table: mapping.table,
              type: 'validation',
              message: `Attribute column '${attr.column}' does not exist in table '${mapping.table}'`,
            })
          }
        }
      }

      // Validate foreign key columns
      if (mapping.foreignKeys) {
        for (const fk of mapping.foreignKeys) {
          if (!metadata.columns.has(fk.column)) {
            errors.push({
              table: mapping.table,
              type: 'validation',
              message: `Foreign key column '${fk.column}' does not exist in table '${mapping.table}'`,
            })
            continue
          }

          // Check if target table exists
          if (!tables.includes(fk.targetTable)) {
            errors.push({
              table: mapping.table,
              type: 'validation',
              message: `Foreign key target table '${fk.targetTable}' does not exist`,
            })
          }
        }
      }
    } catch (error) {
      errors.push({
        table: mapping.table,
        type: 'validation',
        message: `Failed to validate mapping: ${error instanceof Error ? error.message : String(error)}`,
        detail: error,
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate that entityClass exists in ontology (if store is available)
 */
export function validateEntityClasses(
  mappings: TableMapping[],
  existingClasses: Set<string>,
): IngestError[] {
  const errors: IngestError[] = []

  for (const mapping of mappings) {
    if (!existingClasses.has(mapping.entityClass)) {
      errors.push({
        table: mapping.table,
        type: 'validation',
        message: `Entity class '${mapping.entityClass}' is not defined in ontology. Define it first with ontology_define.`,
      })
    }
  }

  return errors
}
