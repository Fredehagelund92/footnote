/**
 * Chats shared as a link (FR-721): a person sends a copy of one Ask chat on purpose, under their
 * name, and anyone signed in opens it, each source as they may read it. Agents never read any of it.
 */
export { createSharedChatsService, type SharedChatsService } from './service.ts'
