// The school's courses, in the order the home page lists them. Only electricity is written so
// far; the others are listed as coming soon.

import { courseHref } from './router';
import { LESSONS } from './registry';

export interface CourseMeta {
  /** "01" */
  n: string;
  /** Short name for lists: "Natural gas". */
  name: string;
  /** Where the course lives, once it exists. */
  href?: string;
  lessons?: number;
}

export const COURSES: CourseMeta[] = [
  { n: '01', name: 'Electricity & energy', href: courseHref(), lessons: LESSONS.length },
  { n: '02', name: 'Natural gas' },
  { n: '03', name: 'Agricultural commodities' },
  { n: '04', name: 'Oil & petroleum' },
  { n: '05', name: 'Weather derivatives' },
  { n: '06', name: 'Shipping & freight' },
  { n: '07', name: 'Compute capacity' },
];
