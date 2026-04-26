/**
 * DEPRECATED — superseded by /topics/[slug] (ClusterOverviewManager).
 *
 * This component used to pop a right-side drawer with the pages inside
 * a cluster. It had a move-to-cluster dropdown per row but no bulk
 * assignment, which made adding many pages to a new cluster tedious.
 *
 * 2026-04-24: replaced by the dedicated cluster overview page at
 *   /topics/[slug]
 * which owns its own layout, supports multi-select bulk assign, and
 * has room for metadata/rename/delete affordances the drawer couldn't
 * fit.
 *
 * Rows in the /topics table now call `router.push(\`/topics/\${slug}\`)`
 * on click instead of opening this drawer. NewClusterDialog also
 * navigates to the new cluster's overview right after creation.
 *
 * Left as an export-less stub so the filename doesn't come back from a
 * rebase / stash. Safe to delete once confirmed nothing imports it.
 */
export {};
