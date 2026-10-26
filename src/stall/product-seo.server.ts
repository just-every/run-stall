import { env } from 'cloudflare:workers'
import type { Bindings } from '../auth.server'
import { aggregateReviews,publishedReviews } from './reviews/store'
export async function publicProductSeo(handle:string) {
 const found=await publishedReviews((env as Bindings).DB,handle)
 if(!found)return {title:'Product · Stall',description:'',reviews:[],structuredData:null}
 const {product,reviews}=found,aggregate=aggregateReviews(reviews)
 return {title:product.value.details?.seo?.title??product.value.name,description:product.value.details?.seo?.description??product.value.description,reviews,
  structuredData:{'@context':'https://schema.org','@type':'Product',name:product.value.name,sku:product.value.sku,description:product.value.description,
   ...(aggregate?{aggregateRating:{'@type':'AggregateRating',...aggregate,bestRating:5,worstRating:1}}:{}),
   review:reviews.map(review=>({'@type':'Review',name:review.title||`${review.rating} of 5 stars`,reviewBody:review.body,datePublished:review.date,author:{'@type':'Person',name:review.reviewerName},reviewRating:{'@type':'Rating',ratingValue:review.rating,bestRating:5,worstRating:1},...(review.imported?{isBasedOn:{'@type':'CreativeWork',name:`Imported from ${review.source}`}}:{}),...(review.media.some(file=>file.kind==='image')?{image:review.media.filter(file=>file.kind==='image').map(file=>file.url)}:{})})),
  },
 }
}
