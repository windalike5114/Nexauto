import {redirect} from 'next/navigation';

// Keep the historical offers URL without exposing an unpaginated catalogue.
export default function PromotionPage(){redirect('/specials');}
