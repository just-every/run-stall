/** Additional authority for a scoped storefront purchase. Native guest checkout
 * keeps its own public-origin contract; an app never inherits that guest door. */
export type CommerceAuthority={check:()=>Promise<void>;statements:()=>D1PreparedStatement[]}
