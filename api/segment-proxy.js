import {fetchWithSheetsAuth,valuesToCsv} from './_sheets-sa.js';
export const config={runtime:'edge'};
export default async function handler(){
  try{
    const range=encodeURIComponent('SEGMENT!A:I');
    const r=await fetchWithSheetsAuth('https://www.googleapis.com/auth/spreadsheets.readonly',`https://sheets.googleapis.com/v4/spreadsheets/1mIoA3R9LCUozGBLx4okQoQYWHjZD4tDf-OFM9m6OsQU/values/${range}`,{cache:'no-store'});
    if(!r.ok)return new Response('Segment source unavailable',{status:502});
    const data=await r.json();return new Response(valuesToCsv(data.values||[]),{headers:{'Content-Type':'text/csv; charset=utf-8','Cache-Control':'no-store'}});
  }catch{return new Response('Segment source unavailable',{status:502});}
}
