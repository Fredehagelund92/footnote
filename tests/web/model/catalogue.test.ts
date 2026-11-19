import { describe, expect, it } from 'vitest'
import { manifest } from '../../../src/connectors/dbt-metricflow/manifest'
import { builtInManifests } from '../../../src/connectors/manifests'
import { connectFormFor, testFor } from '../../../src/web/api/mock/integrations'
import { connectorById, connectors, connectorByTool } from '../../../src/web/model/catalogue'
import { logos } from '../../../src/web/model/integrations'

/* The catalogue's cells, each drawn from a connector's manifest, and its dbt cell. */

describe('the catalogue', () => {
  it('draws only the tools built in, so no cell promises one that is not', () => {
    expect(connectors.map((c) => c.id).sort()).toEqual(builtInManifests.map((m) => m.id).sort())
    expect(connectorById('notion')).toBeUndefined()
  })
})

describe('the dbt cell', () => {
  it('comes from the manifest, with its logo, and can be connected', () => {
    expect(connectorById('dbt-metricflow')).toMatchObject({
      name: manifest.tool,
      kind: 'definitions',
      blurb: manifest.summary,
      logo: logos['dbt-metricflow'],
      access: manifest.access,
      places: true,
      group: 'semantic model',
      domainField: 'config.meta.domain',
    })
    expect(connectorByTool('dbt')?.id).toBe('dbt-metricflow')
  })

  it('is the only dbt in the catalogue', () => {
    expect(connectors.filter((connector) => connector.name === 'dbt')).toHaveLength(1)
    expect(connectorById('dbt')).toBeUndefined()
  })

  it('never promises a link to a file its definitions do not name', () => {
    expect(connectorById('dbt-metricflow')?.noFileLinks).toBe(true)
    expect(connectorById('cube')?.noFileLinks).toBeUndefined()
  })
})

describe('dbt on the mock', () => {
  it('starts its form from the manifest’s defaults', () => {
    const form = connectFormFor('dbt-metricflow', [])!
    const value = (key: string) => form.fields.find((field) => field.key === key)?.value
    expect(form.source).toBeNull()
    expect([value('repository'), value('ref'), value('file')]).toEqual([
      '',
      'main',
      'semantic_manifest.json',
    ])
  })

  it('finds its semantic models to choose from, once it has a repository', () => {
    const config = {
      location: 'git',
      repository: 'https://git.example.com/a.git',
      ref: 'main',
      file: 'a.json',
    }
    const test = testFor('dbt-metricflow', { config, secrets: {} })
    expect(test.ok).toBe(true)
    expect(test.scopes.map((scope) => [scope.id, scope.metrics, scope.dimensions])).toEqual([
      ['orders', 9, 3],
      ['customers', 1, 4],
      ['_shared', 2, 0],
    ])
    expect(testFor('dbt-metricflow', { config: {}, secrets: {} }).ok).toBe(false)
  })
})
