export function outputGroups(files=[]){
 const rank=name=>/^Auto BTR\.xlsx$/i.test(name)?0:/^BTPExcel\.xlsx$/i.test(name)?1:/^EBTP-.*\.xlsx$/i.test(name)?2:3;
 const main=files.filter(f=>rank(f.name)<3).sort((a,b)=>rank(a.name)-rank(b.name)||a.name.localeCompare(b.name));
 const supporting=files.filter(f=>rank(f.name)===3).sort((a,b)=>(a.name==='SAP SO Batch Plan.xlsx'?-1:0)-(b.name==='SAP SO Batch Plan.xlsx'?-1:0)||a.name.localeCompare(b.name));
 return [{title:'Main outputs',main:true,files:main},{title:'Supporting files',main:false,files:supporting}].filter(g=>g.files.length);
}
