---
title: Markdown in Git and Google Drive
line: The two document connectors, which turn new and changed documents in the folders you choose into suggestions for owners.
group: Connectors
order: 6
reviewed: 2026-11-20
---

Turn the documents your teams already write into suggestions for the owners who check them. An admin chooses folders, in a Git repository or in Google Drive, and maps each to one domain. Each read makes one suggestion per new or changed document, in the Inbox of that domain's owners. A read never publishes: an owner does.

Both only read: nothing is ever written to the repository or to Drive. Who may read a document in the tool is not copied: once an owner publishes a suggestion, everyone in the workspace reads it. [What a read does to documents](../connectors.md#what-a-read-does-to-documents) says what happens to a document that changes, is declined, leaves or is skipped.

## Markdown in Git

Markdown files in the folders you choose of a Git repository. It is in beta.

An admin adds it in Settings, Integrations, as [Integrations](../help/integrations.md) says:

| Field                   | What it is                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Repository address      | The https address the repository is cloned from. Plain http only to this computer, outside production                                |
| Branch or tag           | The documents are read as they are on it. `main` to start with                                                                       |
| Folder                  | The folder that holds the documents. Its folders are the ones to choose from next. Empty for the top                                 |
| Read-only token         | A token that may only read this repository, kept in the secret store and sent only to its address. Empty for a public repository     |
| Link to a file          | Under More settings: how your Git host links to a file, with `{commit}` and `{path}`. Empty for GitHub, gitlab.com and bitbucket.org |
| User name for the token | Under More settings: most hosts take any. Change it only if yours asks                                                               |

### What a read does

1. It fetches the one commit the branch or tag names, read only, and removes it afterwards.
2. It lists the `.md` and `.markdown` files of the chosen folders. A file belongs to the deepest chosen folder it is in. The folder itself is offered too, under its own name or as Top of the repository, when it holds Markdown files of its own.
3. Each file is one document: its first top heading, or its file name, is its title, the commit's time is when it changed, and its link opens the file at that commit.
4. Every read lists the folders whole, so a file that left the chosen folders is gone, and its open suggestion is withdrawn.

A file larger than a read takes, or one that is not UTF-8 text, is left out with a warning, and its suggestion stays as it was.

### Schedule and limits

It is read once a day by default, every 15 minutes at the shortest, and it is out of date after 2 days. A read takes at most two minutes and 5,000 files. A source makes at most 5 suggestions a day: the other documents wait, and go first the next day.

## Google Drive

Google Docs in Google Drive folders you share with a service account. It is in beta.

### Set it up

1. In a Google Cloud project, switch the Google Drive API on and create a service account. It needs no role in the project. Create a JSON key for it.
2. In Google Drive, share each folder to read with the service account's address, as Viewer. It sees only what is shared with it, never the rest of anyone's Drive.
3. In Settings, Integrations, add Google Drive with the key. **Test connection** signs in, names the account to share with, and lists the shared folders and the folders directly in them. Choose the folders, and map each to a domain.

| Field                  | What it is                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Service account key    | The JSON key file, as Google Cloud gives it. Kept in the secret store, never shown again, and sent nowhere: a read signs with it              |
| Google API address     | Under More settings: where Drive is reached. Empty for Google's own. Change it only to reach Google through an endpoint of your company's own |
| Google sign-in address | Under More settings: where the service account signs in. Empty for Google's own. Change it with the API address                               |

The key is bound to both addresses. A change to either forgets the stored key unless a new one comes with it, so nobody can send a key they never saw to a host of their choosing.

### What a read does

1. It signs in with the key, for an access token that can only view and lasts an hour. The token lives in memory for that read only. Every request to Drive only reads.
2. It walks the chosen folders and the folders under them. A document belongs to the deepest chosen folder it is in. A chosen folder the account can no longer see makes the read partial, and nothing in it is gone until an admin takes the folder out of the source's choice.
3. The first read exports every Google Doc of those folders as Markdown. Its name is its title, its link opens it in Google Docs, and when it changed is Drive's own date.
4. After that, a read asks Drive for the changes since the last one. A changed document is read again. One that was deleted, trashed, moved out of the chosen folders or hidden from the account is gone.
5. When a folder under the chosen ones changed or moved, a week has passed, or the source's settings or choice of folders changed, the next read is a whole read again, so nothing a list of changes missed stays missed.

Other files, such as sheets, slides and PDFs, are left alone. A document longer than a read takes, or one whose owner does not let viewers download it, is left out with a warning, and its suggestion stays as it was.

### When a read fails

| On screen              | What happened                                                     |
| ---------------------- | ----------------------------------------------------------------- |
| The key was refused    | Google refused the key, or it is not a service account's JSON key |
| It couldn't be reached | Google cannot be reached, or answers with an error of its own     |
| It was asked too often | Google said to slow down                                          |

When the Google Drive API is off in the project, **Test connection** stops at its step Sign in to Google and says to switch the API on in the service account's Google Cloud project. A scheduled read shows only that it couldn't be read.

The last two clear by themselves: the source tries again sooner, and never sooner than Google asks.

### Schedule and limits

It is read once a day by default, every 15 minutes at the shortest, and it is out of date after 2 days. A read takes at most ten minutes and 5,000 documents. A source makes at most 20 suggestions a day: the other documents wait, and go first the next day.
