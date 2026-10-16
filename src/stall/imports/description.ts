// One pass can expose a new tag (`<scr<b>ipt>`), so strip until the text is stable.
function stripTags(html: string): string {
 let text = html
 let previous: string
 do {
  previous = text
  text = text
   .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
   .replace(/<br\s*\/?>/gi,'\n')
   .replace(/<\/(p|div|li|h[1-6])\s*>/gi,'\n')
   .replace(/<[^>]*>/g,'')
 } while (text !== previous)
 return text
}

// Shopify stores rich descriptions. The first release's listings are plain
// text: retain source HTML in custody, strip formatting for the product value.
export function plainDescription(html: string): string {
 const entities: Record<string,string> = { amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ' }
 return stripTags(html)
  .replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (match,code:string) => {
   if(code[0]!=='#')return entities[code.toLowerCase()]??match
   const point=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1))
   return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):''
  }).trim()
}
