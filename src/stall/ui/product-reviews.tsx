import type { PublicReview } from '../reviews/model'
import { aggregateReviews } from '../reviews/model'
import { Section } from './primitives'
const sources:Record<string,string>={'judge-me':'Judge.me',yotpo:'Yotpo',okendo:'Okendo',loox:'Loox',stamped:'Stamped',shopify:'Shopify Product Reviews',native:'Merchant entered'}
export function ProductReviews({reviews}:{reviews:PublicReview[]}) {
 const aggregate=aggregateReviews(reviews)
 return <Section title="Customer reviews" className="st-store-panel">
  {aggregate?<p><strong>{aggregate.ratingValue.toFixed(1)} of 5 stars</strong> · {aggregate.reviewCount} {aggregate.reviewCount === 1 ? 'review' : 'reviews'}</p>:<p>No reviews yet.</p>}
  <div className="st-stack">{reviews.map(review=><article className="st-panel st-stack" key={review.id}>
   <h3>{review.title||`${review.rating} of 5 stars`}</h3>
   <p>{review.rating} of 5 stars · {review.reviewerName} · <time dateTime={review.date}>{review.date}</time></p>
   <p>{review.imported?`Imported from ${sources[review.source]??review.source}`:'Merchant-entered review'}{review.sourceVerified?` · Verified by ${sources[review.source]??review.source}`:''}</p>
   <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{review.body}</p>
   {review.reply&&<blockquote><strong>Merchant reply</strong><p>{review.reply}</p></blockquote>}
   <div className="st-actions">{review.media.map(file=>file.kind==='video'?<video key={file.id} controls preload="metadata" src={file.url} aria-label={`Review video from ${review.reviewerName}`} style={{maxWidth:'100%',maxHeight:320}}/>:<img key={file.id} src={file.url} alt={`Review photo from ${review.reviewerName}`} loading="lazy" style={{maxWidth:'100%',maxHeight:320}}/>)}</div>
  </article>)}</div>
 </Section>
}
