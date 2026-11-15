import { setReaderLocale } from '@/lib/dates'

// The units read dates in the reader's locale; a reader here is British English, as the browser
// journeys are (the playwright configs set locale). A test of another locale pins its own.
setReaderLocale('en-GB')
