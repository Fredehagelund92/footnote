/**
 * The families split back into their metrics as an edition has them (FR-142): a family the edition
 * does not serve, and the latest split of it made in it or before. Whether a split applies is read
 * from what the edition serves, as the rest of its content is, so two editions with the same
 * content read the same, however they were made and whatever was joined after. `seq` is a SQL
 * expression for the edition.
 */
export const standingSplits = (seq: string) => `(
  select distinct on (x.family_key) x.*
    from family_splits x
   where x.split_in <= ${seq}
     and not exists (select 1 from vocab_term_service s
                      where s.term_key = x.family_key and s.editions @> (${seq})::bigint)
   order by x.family_key, x.split_in desc, x.split_at desc)`

/** The edition agents get now. */
export const liveSeq = '(select seq from live_edition)'
