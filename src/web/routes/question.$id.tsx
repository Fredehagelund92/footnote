import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { questionParts } from '@/components/footnote/question-parts'

// The page a question link opens (Ask someone who knows): outside the app's shell, as sign-in is,
// signed in or not. Its code loads when a link is opened, handed what it uses of the app as its
// parts, so the first load is split no further.
const QuestionPage = React.lazy(() => import('@/pages/question'))

export const Route = createFileRoute('/question/$id')({
  component: () => (
    <React.Suspense fallback={null}>
      <QuestionPage parts={questionParts} />
    </React.Suspense>
  ),
})
