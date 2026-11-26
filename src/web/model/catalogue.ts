import type { ConnectorManifest } from '@domain/connector-manifest'
import { builtInManifests } from '../../connectors/manifests'
import { logos, type Connector, type ConnectorKind } from './integrations'

// The catalogue of connectors, drawn from the manifests built into the repository, so a connector
// added there shows in Integrations with no change to the app. Only the pages that list or connect
// connectors (Integrations, Definitions) and the mock load this module: it carries every manifest,
// so the first load must not.

/**
 * How the app words a connector it knows well: the lead of its page, what it calls a group of
 * metrics, where its definitions say their domain, and how its model declares a family. All of it
 * is optional: a connector without an entry is drawn from its manifest alone.
 */
/** A measure of Cube's that names its family, as its model writes it (meta.footnote). */
const CUBE_FAMILY = `measures:
  - name: revenue_eur
    type: sum
    sql: amount_eur
    meta:
      footnote:
        family: revenue
        by:
          currency: EUR`

const words: Record<
  string,
  Partial<
    Pick<
      Connector,
      'label' | 'lead' | 'group' | 'domainField' | 'noFileLinks' | 'serverSetting' | 'familyExample'
    >
  >
> = {
  cube: {
    // From a Git repository an admin names, or a folder whoever runs the server names: the page
    // says which, so the lead says neither.
    lead: 'Reads your Cube definition files. Read-only, and it keeps no calculation.',
    domainField: 'meta.domain',
    serverSetting: 'CUBE_MODEL_DIR',
    familyExample: CUBE_FAMILY,
  },
  'cube-cloud': {
    // Beside Cube model files, which read the same tool: its headings say which.
    label: 'Cube Cloud',
    lead: 'Reads the metadata of a Cube Cloud deployment through its API. Read-only, and it never reads data or SQL. Cube Cloud gives no calculations, so a change to one is seen only through what Cube Cloud shows of the member. That is its type, how it adds up, its title, description, format or meta.',
    domainField: 'meta.domain',
    familyExample: CUBE_FAMILY,
  },
  'dbt-metricflow': {
    lead: 'Reads the semantic manifest your dbt pipeline writes, from where you keep it. Read-only, and it keeps no calculation and no value.',
    // dbt has views too, as tables are built; a group of its metrics is a semantic model, whose
    // domain is in its config's meta.
    group: { one: 'semantic model', many: 'semantic models' },
    domainField: 'config.meta.domain',
    noFileLinks: true,
    familyExample: `metrics:
  - name: revenue_eur
    config:
      meta:
        footnote:
          family: revenue
          by:
            currency: EUR`,
  },
  'google-drive': {
    lead: 'Reads the Google Docs in folders shared with its service account. Each new or changed document becomes one suggestion for the owners of its domain.',
  },
  'git-markdown': {
    lead: "Reads the Markdown files in a repository. Each new or changed file becomes one suggestion for the owners of its folder's domain.",
  },
}

/** A connector of the catalogue, from its manifest. */
export function connectorOf(manifest: ConnectorManifest): Connector {
  const key = manifest.secrets.find((secret) => secret.file)
  const logo = logos[manifest.id]
  // A choice the server alone can make is a choice of where the file lives, Git among the places.
  const places = manifest.config.fields.some((field) =>
    field.options?.some((option) => option.serverOnly),
  )
  const api = manifest.egress.hosts.length > 0 && !manifest.egress.git && !key && !places
  return {
    id: manifest.id,
    name: manifest.tool,
    label: manifest.tool,
    kind: manifest.kind === 'definitions' ? 'definitions' : 'context',
    ...(logo ? { logo } : {}),
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    blurb: manifest.summary,
    ...(key ? { keyFile: key.key } : {}),
    ...(places ? { places: true as const } : manifest.egress.git ? { git: true as const } : {}),
    ...(api ? { api: true as const } : {}),
    ...(manifest.capabilities.discover ? { discovers: true as const } : {}),
    access: [...manifest.access],
    warnings: manifest.warnings,
    ...words[manifest.id],
  }
}

const kindOrder: Record<ConnectorKind, number> = { definitions: 0, context: 1 }

/** The catalogue: definitions first, then context, each by name, as the design lays it out. */
export const connectors: Connector[] = builtInManifests
  .map(connectorOf)
  .sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  )

export const connectorById = (id: string | undefined) => connectors.find((c) => c.id === id)

/** The connector of a tool, by the name people say it by ("Google Drive"); none for another. */
export const connectorByTool = (tool: string | undefined) => connectors.find((c) => c.name === tool)

/**
 * Where setup sends someone to connect their definitions: the connect flow of the first
 * definitions tool of the catalogue that can be connected, or Integrations when there is none.
 */
export const definitionsConnectHref = () => {
  const connector = connectors.find((c) => c.kind === 'definitions')
  return connector ? `/settings/integrations/${connector.id}/connect` : '/settings/integrations'
}
