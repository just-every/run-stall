import { checkedEndpoint } from '../headless/endpoint'
import { rawBytes,sniff,encode } from '../files'
import { fail } from '../model'
import { maxUploadBytes } from '../listing'
const kinds:Record<string,'image'|'video'>={'image/png':'image','image/jpeg':'image','image/gif':'image','image/webp':'image','video/mp4':'video','video/webm':'video'}
/** Read only public media, without credentials or redirects, before any native write. */
export async function copyReviewMedia(url:string) {
 const checked=await checkedEndpoint(url)
 const response=await fetch(checked,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{accept:'image/*, video/*'}})
 if(!response.ok)fail('REVIEW_MEDIA','A review file could not be copied. Keep the source app until every file is owned.')
 const bytes=await rawBytes(response,maxUploadBytes),mime=sniff(bytes)
 if(!mime||!kinds[mime])fail('REVIEW_MEDIA','Only supported image and video bytes may be imported.')
 return {id:crypto.randomUUID(),kind:kinds[mime],mime,data:encode(bytes)}
}
