---
title: Back up, restore and upgrade
line: What to back up, how to prove a backup restores, how to restore it, and how to upgrade and roll an upgrade back.
group: Run the service
order: 7
reviewed: 2026-11-20
---

What to back up, how to prove a backup restores, how to restore it, and how to upgrade and roll an upgrade back. The commands are for `docker compose` on one computer, as in [Try the demo](try-the-demo.md), run from the clone's folder.

## What to back up

| What                                  | Where                                   | Why                                                                                                                         |
| ------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The database                          | The volume `footnote_db`                | Everything people wrote and decided, the history log, agents' access and the settings                                       |
| The keys                              | The volume `footnote_keys`              | Without them every connected agent must sign in again, and questions an agent is asking for a suggestion cannot be finished |
| The secret store                      | The folder `secrets` in `footnote_keys` | The tokens and signed links of tools connected in Settings. Without them, each read fails                                   |
| Your own Cube model, when you use one | The folder `CUBE_MODEL_DIR` names       | It is only read here. It is yours, and lives wherever you keep it                                                           |

The keys and the secret store are secrets, so keep their backups where only you can read them. Never copy the database volume's files while it runs.

## Back up

With everything running:

```sh
docker compose exec -T footnote sh -c 'pg_dump --format=custom --dbname="$DATABASE_URL_MIGRATE"' > footnote.dump
docker compose exec -T footnote tar -C /var/lib/footnote -cf - . > footnote-keys.tar
```

`footnote.dump` is the whole database, taken in one consistent snapshot while the service keeps running. `footnote-keys.tar` holds the three key files and the secret store. Copy both off this computer.

## The restore drill

The drill proves a backup restores, without touching your database:

```sh
docker compose exec footnote npm run db:restore-drill
```

1. It backs up the database with `pg_dump`.
2. It restores that into a new scratch database, in one transaction.
3. It proves the copy is the same (below).
4. It prints the times and a verdict, `PASSED` or `FAILED`, and drops the copy.

It takes about a minute on the demo and changes nothing in your database. Run it before every upgrade, and now and then on its own.

The copy has to match on all of these:

- every table's rows and every sequence;
- every sealed edition's digest;
- the content digest of every item and vocabulary version an edition serves;
- the history log's hash chain.

| Option           | What it does                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `--source <url>` | Backs up this database, as the owner or a superuser. By default it is `DATABASE_URL_MIGRATE` |
| `--json`         | Prints the full report                                                                       |
| `--keep`         | Keeps the scratch copy                                                                       |

It exits with 1 on any difference. Outside the containers it needs `pg_dump` and `pg_restore` from PostgreSQL 18 on `PATH`.

## Restore

To bring back a backup, onto this computer or a new one with the same version checked out:

```sh
docker compose down --volumes            # only when replacing what is there: this deletes it
docker compose up -d --wait db
docker compose run --rm --no-deps -e SEED_DEMO=off footnote npm run db:migrate   # makes the roles
docker compose exec -T db dropdb -U postgres footnote
docker compose exec -T db createdb -U postgres --owner=context_layer_owner --template=template0 footnote
docker compose exec -T db pg_restore -U postgres --dbname=footnote --single-transaction --exit-on-error < footnote.dump
docker compose run --rm --no-deps -T footnote tar -C /var/lib/footnote -xf - < footnote-keys.tar
docker compose up -d --wait
```

The third line makes the database roles, which a dump does not carry. The next three lines replace the empty database with the backup.

On the next start, `docker compose logs footnote` says `applied 0 migrations`, and no demo is loaded. Whoever was signed in still is, and agents stay connected, because the keys came back too.

## Upgrade

Database migrations only go forward, and an older version refuses a database a newer one has migrated. So an upgrade starts with a backup that is known to restore.

1. Read the release notes of every version between yours and the new one.
2. [Back up](#back-up) the database and the keys, and run the [restore drill](#the-restore-drill). Go on only when it says `PASSED`.
3. Get the new version and start it:

   ```sh
   git fetch --tags && git checkout <new version>
   docker compose build
   docker compose up -d --wait
   ```

4. Check `docker compose logs footnote`, which says how many migrations it applied. Open the web app and see your data.

The service applies new migrations before it serves, each in a transaction of its own. If one fails, the service stops with the reason. That migration's changes are not kept, and the ones before it are. Fix the cause and start again, or [roll back](#roll-back).

## Roll back

Rolling back means going back to the backup from step 2 of the upgrade. Anything written since is lost, so roll back soon or not at all.

```sh
git checkout <previous version>
docker compose build
```

Then [restore](#restore) `footnote.dump` and `footnote-keys.tar` from before the upgrade. Without a restore, the previous version stops with `Migration history differs at ...`, on purpose.

## Elsewhere

In production the database and the keys' volume are wherever your host keeps them, so back up both there in the same way: see [Run in production](run-in-production.md). Running the service from source, the same parts live in the files and the database your local settings name: see [the developers' guide](development.md#run-the-service-from-source).
