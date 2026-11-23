/**
 * The families split back into their metrics as an edition has them (FR-142), as the database
 * reads them (`serving_family_splits`): one definition for serving and for the service. `seq` is
 * a SQL expression for the edition.
 */
export const standingSplits = (seq: string) => `serving_family_splits((${seq})::bigint)`

/** The edition agents get now. */
export const liveSeq = '(select seq from live_edition)'
