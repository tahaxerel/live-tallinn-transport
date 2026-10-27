import fs from "node:fs"; import path from "node:path";
const D = process.argv[2];
const AREAS = {KE:"Kesklinn",LA:"Lasnamäe",NO:"Nõmme",KR:"Kristiine",MU:"Mustamäe",HA:"Haabersti",PT:"Põhja-Tallinn",PI:"Pirita",P:"Pargi ja reisi"};
const ROUTES = {1:"Narva mnt",2:"Ahtri",3:"Gonsiori - Laagna",4:"Tartu mnt",5:"Juhkentali",6:"Järvevana",7:"Pärnu mnt",8:"Estonia - Endla - Sõpruse",9:"Paldiski mnt",10:"Smuuli",11:"Peterburi mnt",12:"Nõmme keskus",13:"Sõpruse pst",14:"Tammsaare tee",15:"Mustamäe tee",19:"Reidi tee",ST:"Sadama tramm"};
const idsIn = f => [...new Set([...fs.readFileSync(path.join(D,"html",f),"utf8").matchAll(/src='\/last\/(cam\d+)\.jpg'/g)].map(m=>m[1]))];
const all = fs.readFileSync(path.join(D,"html/all.html"),"utf8");
const names = Object.fromEntries([...all.matchAll(/\{ 'cam':'(cam\d+)', 'name': '([^']*)'/g)].map(m=>[m[1],m[2].trim()]));
const order = idsIn("all.html");
const cams = order.map(id => ({ id, name: names[id] || null, url: `https://ristmikud.tallinn.ee/last/${id}.jpg`, district: [], corridor: [] }));
const byId = Object.fromEntries(cams.map(c=>[c.id,c]));
for (const [t,n] of Object.entries(AREAS)) for (const id of idsIn(t+".html")) (byId[id] ||= (cams.push({id,name:names[id]||null,url:`https://ristmikud.tallinn.ee/last/${id}.jpg`,district:[],corridor:[]}), cams.at(-1))).district.push(n);
for (const [t,n] of Object.entries(ROUTES)) for (const id of idsIn(t+".html")) (byId[id] ||= (cams.push({id,name:names[id]||null,url:`https://ristmikud.tallinn.ee/last/${id}.jpg`,district:[],corridor:[]}), cams.at(-1))).corridor.push(n);
for (const c of cams) { c.name = (c.name||"").replace(/\s+/g," "); c.note_star = c.name.includes("*"); }
fs.writeFileSync(path.join(D,"cameras.json"), JSON.stringify(cams,null,1));
console.log("cameras on front page:", order.length, "total unique:", cams.length, "names in JS:", Object.keys(names).length);
const cnt={}; cams.forEach(c=>(c.district.length?c.district:["(semt yok)"]).forEach(d=>cnt[d]=(cnt[d]||0)+1)); console.log(cnt);
console.log("starred:", cams.filter(c=>c.note_star).length);
