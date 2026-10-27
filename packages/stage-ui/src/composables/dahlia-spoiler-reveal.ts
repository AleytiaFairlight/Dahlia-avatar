// Dahlia: the styles and the reveal behaviour for the rich text her chat renders that AIRI's base pipeline lacks -
// GitHub-flavored tables/strikethrough/task lists and Discord-style ||spoilers||. The markdown is rendered with
// v-html, so the spoiler spans carry no Vue handlers; one delegated listener on the document reveals any spoiler the
// owner clicks, or presses Enter/Space on while it is focused. Imported by the markdown composable so it loads
// wherever markdown renders, with no change to AIRI's renderer component. This is a Dahlia file; AIRI has none.

import './dahlia-markdown.css'

function reveal(event: Event) {
  const spoiler = (event.target as HTMLElement | null)?.closest?.('.spoiler')
  if (!spoiler)
    return
  if (event.type === 'keydown') {
    const key = (event as KeyboardEvent).key
    if (key !== 'Enter' && key !== ' ')
      return
    event.preventDefault()
  }
  spoiler.classList.toggle('spoiler-revealed')
}

// The module is a singleton, so the listeners are registered once. Guarded for the non-DOM contexts (tests, workers)
// that import the markdown composable.
if (typeof document !== 'undefined') {
  document.addEventListener('click', reveal)
  document.addEventListener('keydown', reveal)
}
