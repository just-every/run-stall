// The app's stylesheets (public/stall/), linked by each route.
const sheet = (name: string) => ({ rel: 'stylesheet', href: `/stall/${name}.css` })
export const deskStyles = [sheet('base'), sheet('desk')]
export const storeStyles = [sheet('base'), sheet('store')]
