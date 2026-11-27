import {
  proposalAttributes,
  questionIds,
  type MarkedField,
  type ProposalAttribute,
  type QuestionId,
} from './proposal-attributes.ts'

/*
  The questions only the person can answer about an agent's draft (FR-121). write_draft lists them
  with the draft, for the agent to ask in its own words; the person answers them in the chat or in
  Footnote's own form.
*/

/** One question for the person, in the tool's result. */
export type AgentQuestion = {
  id: QuestionId
  field: MarkedField
  question: string
  /** The closed choices, when there are any: area ids, kinds or vocabulary keys. */
  options?: string[]
}

/** The attribute each question asks about: the one whose `asks` names it. */
export const questionFields = Object.fromEntries(
  questionIds.map((id) => {
    const owner = (Object.keys(proposalAttributes) as ProposalAttribute[]).find((name) =>
      (proposalAttributes[name].agent as { asks?: readonly QuestionId[] }).asks?.includes(id),
    )
    return [id, owner]
  }),
) as Record<QuestionId, MarkedField>

/** A question with the field it asks about. */
export const question = (
  id: QuestionId,
  text: string,
  options?: readonly string[],
): AgentQuestion => ({
  id,
  field: questionFields[id],
  question: text,
  ...(options ? { options: [...options] } : {}),
})
