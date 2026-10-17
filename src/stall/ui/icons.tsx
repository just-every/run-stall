// Line icons for the desk's navigation and panels (24px grid, 1.6 stroke).
const paths = {
  orders: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5',
  products: 'M3.5 11.2 11.8 3h8.7v8.7l-8.3 8.3a1.6 1.6 0 0 1-2.2 0l-6.5-6.5a1.6 1.6 0 0 1 0-2.3zM16.5 7.5h.01',
  moveIn: 'M12 3v12M7.5 10.5 12 15l4.5-4.5M4 15v4.5h16V15',
  activity: 'M4 6h2M4 12h2M4 18h2M9.5 6H20M9.5 12H20M9.5 18H20',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.6a7.6 7.6 0 0 1-2.1 1.2L14.8 20.5h-3.6l-.4-2.1a7.6 7.6 0 0 1-2.1-1.2l-1.9.6-1.8-3.1 1.6-1.2a7.4 7.4 0 0 1 0-2.4L3 9.8l1.8-3.1 1.9.6a7.6 7.6 0 0 1 2.1-1.2l.4-2.1h3.6l.4 2.1a7.6 7.6 0 0 1 2.1 1.2l1.9-.6L21 9.8l-1.6 1.3a7.4 7.4 0 0 1 0 2.4z',
  search: 'M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15.5 15.5 21 21',
  down: 'M6 9l6 6 6-6',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  spark: 'M10 3c.6 5.2 2.3 6.9 7.5 7.5-5.2.6-6.9 2.3-7.5 7.5-.6-5.2-2.3-6.9-7.5-7.5C7.7 9.9 9.4 8.2 10 3zM19 3v4M17 5h4M19 16v4M17 18h4',
  agent: 'M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM12 8V4.5M9 13v1.5M15 13v1.5',
  leaf: 'M5 20c2-7 6-11 14-15-1 8-5 12-12 13M5 20c1.5-3.5 4-6 7-8',
} as const
export type IconName = keyof typeof paths
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className ?? 'st-icon'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
