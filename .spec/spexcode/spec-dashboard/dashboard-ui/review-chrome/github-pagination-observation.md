# GitHub Issues pagination observation

Observed on 2026-07-20 with Chromium 150.0.7871.114, signed out, against
`https://github.com/microsoft/vscode/issues`. These are Web-product observations. The REST notes at the
end are supporting API evidence only and were not used to infer the Web behavior.

## List and address

- The list rendered 25 issue rows per page.
- From the bare list, Next was a real `rel="next"` anchor to `?page=2`. Clicking it added one browser
  history entry. Back restored the bare list and Forward restored `?page=2`.
- With `q=is:issue state:open label:bug`, page links serialized `q` first and `page` second:
  `?q=is%3Aissue%20state%3Aopen%20label%3Abug&page=2`.
- Every page number, Previous, and Next was a real anchor. The active page carried
  `aria-current="page"`; the navigation landmark was named `Pagination`; enabled Previous/Next links
  were named `Previous Page` and `Next Page`.
- GitHub's page-1 anchors explicitly used `page=1`, and a direct `?page=1` stayed in the address. The
  absence/presence of page 1 is action history, not a canonical-address error: initial/reset actions omit
  `page`, while pagination back to the first page records `page=1`.

## State transitions

- Submitting a changed query from page 2 pushed a new history entry and removed `page`, returning to
  page 1. Choosing Closed from page 2 did the same while changing only the `state:` token.
- A pagination click, a query submit, a lifecycle-tab change, and a row-detail click each added exactly
  one history entry.
- Opening row 21 from page 2 at `scrollY=1127`, then using browser Back, restored the page-2 URL and
  `scrollY=1127` exactly. The detail address itself contained no list query or page state.

## Boundaries

- Page 40 was the last searchable page for this result set (GitHub exposes only the first 1,000 search
  results): 25 rows, enabled Previous, disabled Next.
- Direct page 41 and page 999999 both returned HTTP 200, preserved the requested URL, rendered zero
  issue rows, and showed `No results` rather than clamping or redirecting. Neither page had an
  `aria-current` page link. On page 41, Previous was a real
  `<a rel="prev" aria-label="Previous Page" href="/microsoft/vscode/issues?page=40">` and Next a real
  `<a rel="next" aria-label="Next Page" href="/microsoft/vscode/issues?page=42">`. Page 999999 kept the
  same real-anchor shape, with hrefs to page 999998 and page 1000000 respectively.

## 390px and accessibility

- At 390x844 the pagination landmark was 358px wide, used two 32px-high wrapped lines, and produced no
  horizontal overflow (`scrollWidth == clientWidth == 390`). Previous, every visible page number, and
  Next remained real links with 32px page hit targets.
- The Chromium accessibility snapshot exposed one `navigation "Pagination"` containing named links.
  The current page remained a link and was distinguished by `aria-current="page"` in the DOM.

## Official REST evidence

GitHub's official REST pagination guide states that paginated endpoints return only a subset, advertise
available navigation through the `Link` response header, and carry page selectors in those link URLs.
It also documents `per_page` as an endpoint-controlled page-size input. That supports pushing native
pagination down into forge adapters and following their returned links; it does not define the Web UI's
history, canonicalization, overflow, or responsive behavior.

Source: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api
