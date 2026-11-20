/**
 * Named reports from Ask (FR-622): a person tells the owners what is wrong with an answer, with
 * their name, and sees back in the chat what the owners did. Agents never read any of it. And the
 * ratings of Ask's answers (FR-712), which name no one.
 */
export { createReportsService, type ReportsService } from './service.ts'
export { rateAnswer, ratingsPerMinute, takeBackRating } from './ratings.ts'
