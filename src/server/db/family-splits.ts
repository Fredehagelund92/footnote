/**
 * The families split back into their metrics as an edition has them (FR-142): a family the edition
 * does not serve because of a split. The edition that last ended its service is the split's, or a
 * rollback edition, which has the content of the edition it restores, so that one is read the same
 * way. A family closed for any other reason is not split, and a split joined since reads as it is
 * served. Two editions with the same content read the same. `seq` is a SQL expression for the
 * edition.
 */
export const standingSplits = (seq: string) => `(
  with recursive ended(key, edition) as (
    select f.key, (select max(upper(s.editions)) from vocab_term_service s
                    where s.term_key = f.key and upper(s.editions) <= (${seq})::bigint)
      from (select distinct family_key as key from family_splits) f
     where not exists (select 1 from vocab_term_service s
                        where s.term_key = f.key and s.editions @> (${seq})::bigint)
    union
    select e.key, (select max(upper(s.editions)) from vocab_term_service s
                    where s.term_key = e.key and upper(s.editions) <= ed.restores_seq)
      from ended e join editions ed on ed.seq = e.edition and ed.restores_seq is not null)
  select distinct on (x.family_key) x.*
    from family_splits x join ended e on e.key = x.family_key and e.edition = x.split_in
   order by x.family_key, x.split_in desc, x.split_at desc)`

/** The edition agents get now. */
export const liveSeq = '(select seq from live_edition)'
