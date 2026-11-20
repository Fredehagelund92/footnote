import { defineManifest } from '../../domain/define-manifest.ts'

/**
 * A Cube Cloud deployment (connector model B, the next definitions source after Git Markdown):
 * its public views and their members, read through Cube Cloud's APIs and given as the same
 * `cube:` refs as Cube model files, so a model that moves to Cube Cloud keeps its items' refs. A
 * read trades a Cube Cloud API key for a short-lived token that reads metadata only, then reads
 * the deployment's `/v1/meta`; the deployment's build status says when nothing changed. It
 * never reads data, SQL or private members, and writes nothing. Cube Cloud gives no
 * calculations, so its change marks see metadata only (CON-505).
 */
export const manifest = defineManifest({
  id: 'cube-cloud',
  version: '1.0.0',
  footnote: '^3.3',
  kind: 'definitions',
  tool: 'Cube',
  title: 'Cube Cloud deployment',
  summary:
    'Metrics and dimensions, read from the metadata of a Cube Cloud deployment. It sees no calculations.',
  icon: 'cloud',
  docs: './README.md',
  maintainer: { name: 'Core team' },
  support: 'core',
  maturity: 'experimental',
  refPrefix: 'cube',
  config: {
    fields: [
      {
        key: 'address',
        kind: 'address',
        label: 'Cube Cloud address',
        description: 'The address you sign in to Cube Cloud with.',
        required: true,
        placeholder: 'https://your-team.cubecloud.dev',
      },
      {
        key: 'deployment',
        kind: 'text',
        label: 'Deployment',
        description: 'The deployment’s number: the digits after /deployments/ in its address.',
        required: true,
        placeholder: '42',
        pattern: '^[1-9][0-9]{0,9}$',
        patternMessage: 'Give the deployment’s number, digits only.',
      },
      {
        key: 'apiAddress',
        kind: 'address',
        label: 'REST API address',
        description:
          'The REST API address Cube Cloud shows for the deployment, ending in /cubejs-api/v1. We read its metadata there, and never its data.',
        required: true,
        placeholder: 'https://your-deployment.aws-us-east-1.cubecloudapp.dev/cubejs-api/v1',
      },
      {
        key: 'domainNames',
        kind: 'domain_map',
        label: 'Domain names',
        description:
          'When the model’s meta.domain names a domain differently, choose the domain it means. A name that is already a domain id needs no line.',
      },
      {
        key: 'environment',
        kind: 'text',
        label: 'Environment',
        description:
          'The number of the environment to read. Leave it empty for the production environment.',
        pattern: '^[1-9][0-9]{0,19}$',
        patternMessage: 'Give the environment’s number, digits only.',
        advanced: true,
      },
      {
        key: 'securityContext',
        kind: 'json',
        label: 'Security context',
        description:
          'The security context of the token we ask for, as a JSON object. Cube shows us only what it lets that context see, so it must see every view to read. Leave it empty for none.',
        placeholder: '{ "role": "catalog" }',
        maxLength: 2_000,
        advanced: true,
      },
    ],
  },
  secrets: [
    {
      key: 'apiKey',
      label: 'API key',
      description:
        'A Cube Cloud API key limited to this deployment. We use it only to ask for a token that reads metadata for 5 minutes. We keep it in a secret store and never show it again.',
      required: true,
      boundTo: ['address', 'apiAddress'],
    },
  ],
  access: [
    'An API key limited to this one deployment. We trade it for a token that reads metadata for 5 minutes, and never write to Cube Cloud.',
    'A read takes the names, titles, types and descriptions of public views and their members: never data, SQL or private members.',
    'Cube Cloud gives no calculations, so a change to a calculation alone flags nothing until something Cube Cloud shows of the member changes too: its type, aggregation, title, description, format or meta.',
  ],
  // The API key goes to the Cube Cloud address only, the metadata token to the REST API only.
  egress: { hosts: [{ fromField: 'address', signIn: true }, { fromField: 'apiAddress' }] },
  capabilities: {
    discover: false,
    // The build status is its cursor: a build that has not changed is not read again.
    incremental: true,
    deletions: 'full-listing',
    domain: 'hint',
    marks: 'metadata',
    mergeDimensions: 'by-name',
  },
  schedule: { default: 'PT1H', minimum: 'PT15M' },
  staleAfter: 'PT6H',
  limits: { timeoutSeconds: 120, maxRecords: 100_000 },
  warnings: {
    environment_not_found: {
      level: 'warning',
      title: 'The deployment has no such environment',
      detail:
        'Leave the environment empty for production, or give the number of one of the deployment’s environments.',
    },
    not_cube_meta: {
      level: 'warning',
      title: 'This is not a Cube REST API',
      detail:
        'Copy the REST API address Cube Cloud shows for the deployment, ending in /cubejs-api/v1.',
    },
    token_refused: {
      level: 'warning',
      title: 'The REST API refused the token',
      detail:
        'The REST API address is not the one of this environment, or it refuses the security context. Copy the REST API address Cube Cloud shows for the environment, and check the security context.',
    },
    unreadable_view: {
      level: 'warning',
      title: 'A view could not be read',
      detail:
        'Cube Cloud described it in a way we do not read. It is left out, and the read is in part, so what was read of it before stays as it was.',
    },
  },
  markVersion: 1,
})
