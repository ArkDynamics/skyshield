import { useState, useEffect, useRef, useCallback } from "react";

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const FontLoader = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 14px; }
    body { background: #0a0d14; color: #cbd5e1; font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: #0f1218; }
    ::-webkit-scrollbar-thumb { background: #e07b2a; border-radius: 3px; }
    input, select, textarea, button { font-family: 'Inter', sans-serif; }
    table { border-collapse: collapse; }
    a { text-decoration: none; }
  `}</style>
);

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  // Backgrounds
  bg:       "#0a0d14",
  surface:  "#0f1218",
  card:     "#141821",
  cardHov:  "#1a1f2e",
  border:   "#1e2535",
  borderAct:"#e07b2a",

  // Brand
  orange:   "#e07b2a",
  orangeLt: "#f59b4f",
  orangeDim:"rgba(224,123,42,0.12)",

  // Semantic
  green:    "#2ecc71",
  greenDim: "rgba(46,204,113,0.12)",
  red:      "#e74c3c",
  redDim:   "rgba(231,76,60,0.12)",
  blue:     "#3498db",
  blueDim:  "rgba(52,152,219,0.12)",
  yellow:   "#f1c40f",
  yellowDim:"rgba(241,196,15,0.12)",
  purple:   "#9b59b6",
  purpleDim:"rgba(155,89,182,0.12)",

  // Text
  text:     "#e2e8f0",
  textSub:  "#94a3b8",
  textMuted:"#4a5568",
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEFAULT_COMM = {
  activeHoursStart:"08:00", activeHoursEnd:"18:00",
  activeDays:["Mon","Tue","Wed","Thu","Fri"],
  followupDays:2, coldDays:5,
  templates:{
    initial:"Hi {{name}}, we noticed your area ({{zip}}) was recently hit by a {{storm}} storm. {{company}} offers FREE roof inspections — reply YES to schedule yours today!",
    followup:"Hi {{name}}, just following up on our inspection offer for your home in {{zip}}. We have openings this week — interested?",
    booking:"Hi {{name}}, your roof inspection is confirmed for {{date}} at {{time}} with {{inspector}}. Reply STOP to cancel. — {{company}}",
  }
};

const PLAN_PRICES   = { Starter:297, Pro:497, Elite:997 };
const PLAN_COLORS   = { Starter:C.blue, Pro:C.orange, Elite:C.purple, Trial:C.yellow };
const DAYS_OF_WEEK  = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const SCAN_INTERVALS= [
  {value:"manual",label:"Manual Only"},{value:"daily",label:"Once Daily"},
  {value:"2h",label:"Every 2 Hours"},{value:"1h",label:"Every Hour"},{value:"30m",label:"Every 30 Min"},
];
const INSPECTION_STATUSES   = ["scheduled","completed","no-show","converted","lost"];
const INS_STATUS_COLORS     = {scheduled:C.blue,completed:C.green,"no-show":C.yellow,converted:C.purple,lost:C.red};

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
const INIT_ROOFERS=[
  {id:"r1",name:"Apex Roofing Co",owner:"Marcus Holt",email:"marcus@apexroofing.com",phone:"972-555-0101",plan:"Pro",status:"active",
   territories:["75023","75024","75025"],revenue:57000,leads:42,booked:18,commSettings:{...DEFAULT_COMM},pin:"1234",
   inspectors:[{id:"i1",name:"Jake Torres",phone:"972-555-0201",zones:["75023","75024"]},{id:"i2",name:"Priya Shah",phone:"972-555-0202",zones:["75025"]}],
   inspections:[{id:"ins1",client:"Robert Chen",address:"1204 Oak Ln, Plano TX 75023",date:"2025-06-15",time:"9:00 AM",inspector:"Jake Torres",status:"scheduled"},{id:"ins2",client:"Linda Park",address:"876 Elm St, Plano TX 75024",date:"2025-06-16",time:"11:00 AM",inspector:"Priya Shah",status:"completed"}],
   revenueLog:[{id:"rv1",leadId:"l1",homeowner:"Robert Chen",amount:8500,date:"2025-06-15",note:"Full replacement"}]},
  {id:"r2",name:"Summit Storm Pros",owner:"Diane Reeves",email:"diane@summitstorm.com",phone:"972-555-0102",plan:"Starter",status:"active",
   territories:["75034","75035"],revenue:24000,leads:19,booked:8,commSettings:{...DEFAULT_COMM},pin:"5678",
   inspectors:[{id:"i3",name:"Carl Watts",phone:"972-555-0203",zones:["75034","75035"]}],
   inspections:[{id:"ins3",client:"Amy Johnson",address:"543 Maple Ave, Frisco TX 75034",date:"2025-06-17",time:"2:00 PM",inspector:"Carl Watts",status:"scheduled"}],
   revenueLog:[]},
  {id:"r3",name:"Ironclad Roofing",owner:"Steve Nolan",email:"steve@ironcladroofing.com",phone:"972-555-0103",plan:"Pro",status:"trial",
   territories:["75002","75013"],revenue:6000,leads:7,booked:2,commSettings:{...DEFAULT_COMM},pin:"9999",
   inspectors:[{id:"i4",name:"Monica Ruiz",phone:"972-555-0204",zones:["75002","75013"]}],
   inspections:[],revenueLog:[]},
];
const INIT_STORMS=[
  {id:"s1",type:"Hail",location:"Plano, TX",zip:"75023",severity:"severe",date:"2025-06-12",processed:false,lat:33.0198,lng:-96.6989},
  {id:"s2",type:"Tornado",location:"Frisco, TX",zip:"75034",severity:"extreme",date:"2025-06-13",processed:false,lat:33.1507,lng:-96.8236},
  {id:"s3",type:"Wind",location:"Allen, TX",zip:"75013",severity:"moderate",date:"2025-06-14",processed:true,lat:33.1032,lng:-96.6706},
];
const INIT_LEADS=[
  {id:"l1",homeowner:"Robert Chen",phone:"972-555-1001",zip:"75023",rooferId:"r1",stormType:"Hail",status:"scheduled",notes:"Has insurance claim filed.",contactedAt:"2025-06-12",followupSent:false,conversations:[{role:"ai",msg:"Hi Robert, we noticed your area (75023) was hit by a Hail storm. Apex Roofing Co offers FREE roof inspections — reply YES to schedule!",ts:"2025-06-12 09:01"},{role:"lead",msg:"YES please!",ts:"2025-06-12 09:45"}]},
  {id:"l2",homeowner:"Linda Park",phone:"972-555-1002",zip:"75024",rooferId:"r1",stormType:"Hail",status:"contacted",notes:"",contactedAt:"2025-06-12",followupSent:false,conversations:[{role:"ai",msg:"Hi Linda, just a quick note about your roof after the recent Hail storm in 75024. Apex Roofing Co offers FREE inspections!",ts:"2025-06-12 09:02"}]},
  {id:"l3",homeowner:"Tom Wiley",phone:"972-555-1003",zip:"75025",rooferId:"r1",stormType:"Hail",status:"pending",notes:"",contactedAt:null,followupSent:false,conversations:[]},
  {id:"l4",homeowner:"Amy Johnson",phone:"972-555-1004",zip:"75034",rooferId:"r2",stormType:"Tornado",status:"scheduled",notes:"Prefers morning appointments.",contactedAt:"2025-06-13",followupSent:false,conversations:[{role:"ai",msg:"Hi Amy, Summit Storm Pros here. FREE inspection available after the Tornado — interested?",ts:"2025-06-13 10:00"},{role:"lead",msg:"Sure, when can you come?",ts:"2025-06-13 10:30"}]},
  {id:"l5",homeowner:"Gary Foster",phone:"972-555-1005",zip:"75035",rooferId:"r2",stormType:"Tornado",status:"pending",notes:"",contactedAt:null,followupSent:false,conversations:[]},
  {id:"l6",homeowner:"Nina Ortiz",phone:"972-555-1006",zip:"75002",rooferId:"r3",stormType:"Wind",status:"pending",notes:"",contactedAt:null,followupSent:false,conversations:[]},
  {id:"l7",homeowner:"Brian Cox",phone:"972-555-1007",zip:"75013",rooferId:"r3",stormType:"Wind",status:"contacted",notes:"Called twice, no answer.",contactedAt:"2025-06-14",followupSent:false,conversations:[{role:"ai",msg:"Hi Brian, Ironclad Roofing here. FREE roof inspection after the Wind storm — interested?",ts:"2025-06-14 08:30"}]},
];

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
const T = {
  head: (sz=15,wt=600) => ({ fontFamily:"'Space Grotesk',sans-serif", fontSize:sz, fontWeight:wt, color:C.text }),
  label: { fontSize:11, fontWeight:600, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" },
};
const card = (extra={}) => ({ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:20, ...extra });
const flex = (gap=0,align="center",justify="flex-start") => ({ display:"flex",alignItems:align,justifyContent:justify,gap });
const grid = (cols,gap=12) => ({ display:"grid", gridTemplateColumns:cols, gap });

// ─── UTILITY FUNCTIONS ────────────────────────────────────────────────────────
function isWithinCommWindow(comm){
  const now=new Date(),days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],today=days[now.getDay()];
  if(!comm.activeDays.includes(today)) return false;
  const[sh,sm]=comm.activeHoursStart.split(":").map(Number),[eh]=comm.activeHoursEnd.split(":").map(Number);
  const nowM=now.getHours()*60+now.getMinutes();
  return nowM>=sh*60+sm&&nowM<=eh*60;
}
function fillTemplate(t,v){return t.replace(/{{(\w+)}}/g,(_,k)=>v[k]||"");}
function exportToCSV(leads,roofers,filename="leads.csv"){
  const h=["Homeowner","Phone","ZIP","Roofer","Storm","Status","Notes","Messages"];
  const rows=leads.map(l=>{const r=roofers.find(x=>x.id===l.rooferId);return[`"${l.homeowner}"`,`"${l.phone}"`,`"${l.zip}"`,`"${r?.name||""}"`,`"${l.stormType}"`,`"${l.status}"`,`"${(l.notes||"").replace(/"/g,'""')}"`,`"${l.conversations.length} msgs"`].join(",");});
  const csv=[h.join(","),...rows].join("\n"),blob=new Blob([csv],{type:"text/csv"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

// ─── BASE UI COMPONENTS ───────────────────────────────────────────────────────
function Badge({label,color=C.orange,small=false}){
  const sz=small?10:11;
  return <span style={{display:"inline-flex",alignItems:"center",padding:small?"2px 7px":"3px 9px",borderRadius:4,fontSize:sz,fontWeight:600,background:color+"1a",color,border:`1px solid ${color}33`,letterSpacing:"0.04em",textTransform:"uppercase",whiteSpace:"nowrap",lineHeight:1.4}}>{label}</span>;
}
function Btn({children,variant="default",onClick,style={},disabled,small}){
  const V={
    default:{bg:C.card,color:C.textSub,border:C.border,hov:C.cardHov},
    primary:{bg:C.orange,color:"#fff",border:C.orange},
    success:{bg:C.green,color:"#fff",border:C.green},
    danger: {bg:C.red,  color:"#fff",border:C.red},
    info:   {bg:C.blue, color:"#fff",border:C.blue},
    ghost:  {bg:"transparent",color:C.textMuted,border:"transparent"},
    purple: {bg:C.purple,color:"#fff",border:C.purple},
  };
  const v=V[variant]||V.default;
  return <button onClick={onClick} disabled={disabled} style={{background:v.bg,color:v.color,border:`1px solid ${v.border}`,borderRadius:7,padding:small?"4px 11px":"8px 16px",fontSize:small?11:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,whiteSpace:"nowrap",lineHeight:1.4,...style}}>{children}</button>;
}
function Input({label,value,onChange,type="text",placeholder,style={}}){
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={T.label}>{label}</label>}<input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 11px",color:C.text,fontSize:13,outline:"none",width:"100%",...style}}/></div>;
}
function Textarea({label,value,onChange,placeholder,rows=3}){
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={T.label}>{label}</label>}<textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 11px",color:C.text,fontSize:13,outline:"none",width:"100%",resize:"vertical",lineHeight:1.6}}/></div>;
}
function Select({label,value,onChange,options,style={}}){
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={T.label}>{label}</label>}<select value={value} onChange={e=>onChange(e.target.value)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 11px",color:C.text,fontSize:13,outline:"none",width:"100%",...style}}>{options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}</select></div>;
}
function StatCard({label,value,sub,color=C.orange,icon}){
  return <div style={{...card(),display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
    <div style={{...flex(6)}}>{icon&&<span style={{fontSize:16}}>{icon}</span>}<span style={T.label}>{label}</span></div>
    <div style={{...T.head(28,700),color,lineHeight:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:C.textMuted}}>{sub}</div>}
  </div>;
}
function Tabs({tabs,active,onChange}){
  return <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,marginBottom:20,overflowX:"auto",gap:0}}>
    {tabs.map(t=><button key={t} onClick={()=>onChange(t)} style={{background:"none",border:"none",cursor:"pointer",padding:"10px 14px",fontSize:13,fontWeight:active===t?600:400,color:active===t?C.orange:C.textMuted,borderBottom:active===t?`2px solid ${C.orange}`:"2px solid transparent",marginBottom:-1,whiteSpace:"nowrap"}}>{t}</button>)}
  </div>;
}
function Modal({title,onClose,children,wide}){
  const w=wide?Math.min(680,window.innerWidth-32):Math.min(480,window.innerWidth-32);
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,width:w,maxHeight:"90vh",overflow:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}>
      <div style={{...flex(0,"center","space-between"),padding:"16px 20px",borderBottom:`1px solid ${C.border}`}}>
        <span style={T.head(15,600)}>{title}</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:22,lineHeight:1,padding:"0 4px"}}>×</button>
      </div>
      <div style={{padding:20}}>{children}</div>
    </div>
  </div>;
}
function Divider(){return <div style={{height:1,background:C.border,margin:"4px 0"}}/>;}
function SeverityBadge({severity}){return <Badge label={severity} color={{extreme:C.red,severe:C.orange,moderate:C.yellow}[severity]||C.blue}/>;}
function StatusBadge({status}){return <Badge label={status} color={{active:C.green,trial:C.yellow,cancelled:C.red,pending:C.orange,contacted:C.blue,scheduled:C.green,won:C.purple,cold:C.textMuted}[status]||C.textMuted}/>;}

function MiniBarChart({data}){
  const max=Math.max(...data.map(d=>d.value),1);
  return <div style={{display:"flex",alignItems:"flex-end",gap:8,height:72,padding:"4px 0"}}>
    {data.map((d,i)=><div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",flex:1,gap:4}}>
      <div style={{width:"60%",background:d.color||C.orange,height:`${Math.max((d.value/max)*56,d.value>0?3:0)}px`,borderRadius:"3px 3px 0 0",opacity:0.85}}/>
      <div style={{fontSize:9,color:C.textMuted,textAlign:"center",lineHeight:1.2}}>{d.label}</div>
    </div>)}
  </div>;
}

// ─── TABLE WRAPPER ────────────────────────────────────────────────────────────
function TableWrap({headers,children,empty}){
  return <div style={{...card({padding:0}),overflow:"hidden"}}>
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:500}}>
        <thead><tr style={{background:C.surface}}>
          {headers.map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",...T.label,fontWeight:600}}>{h}</th>)}
        </tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
    {empty&&<div style={{padding:28,textAlign:"center",color:C.textMuted,fontSize:13}}>{empty}</div>}
  </div>;
}
function TR({children,highlight}){return <tr style={{borderBottom:`1px solid ${C.border}`,background:highlight?"rgba(46,204,113,0.03)":undefined}}>{children}</tr>;}
function TD({children,sub,bold,dim,mono,nowrap,style={}}){
  return <td style={{padding:"10px 14px",fontSize:13,fontWeight:bold?600:400,color:dim?C.textSub:C.text,fontFamily:mono?"monospace":undefined,whiteSpace:nowrap?"nowrap":undefined,...style}}>
    {children}{sub&&<div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{sub}</div>}
  </td>;
}

// ─── API / NETWORK ────────────────────────────────────────────────────────────
async function callClaude(messages,system="",max_tokens=1200){
  const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens,system:system||undefined,messages})});
  const data=await res.json();
  return data.content?.map(b=>b.text||"").join("")||"No response";
}
async function sendTwilioSMS(creds,to,body){
  const{sid,token,from}=creds;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:"POST",headers:{"Authorization":`Basic ${btoa(sid+":"+token)}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:to,From:from,Body:body})});
}
async function fetchWeatherAlerts(apiKey,zip){
  const res=await fetch(`https://api.weatherapi.com/v1/alerts.json?key=${apiKey}&q=${zip}`);
  return res.json();
}
let _gcalToken=null,_gcalExpiry=0;
async function getGCalAccessToken(creds){
  if(_gcalToken&&Date.now()<_gcalExpiry-60000) return _gcalToken;
  const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:creds.clientId,client_secret:creds.clientSecret,refresh_token:creds.refreshToken,grant_type:"refresh_token"})});
  const d=await res.json();
  if(d.error) throw new Error(d.error_description||d.error);
  _gcalToken=d.access_token;_gcalExpiry=Date.now()+d.expires_in*1000;
  return _gcalToken;
}

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────
const ACT_ICONS={storm:"⛈",lead:"👤",sms:"💬",booking:"📅",revenue:"💰",roofer:"🏢",system:"⚙",followup:"🔄"};
function ActivityFeed({activities}){
  if(!activities.length) return <div style={{padding:28,textAlign:"center",color:C.textMuted,fontSize:13}}>No activity recorded yet.</div>;
  return <div>{activities.slice(0,60).map((a,i)=>(
    <div key={i} style={{...flex(12,"flex-start"),padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
      <div style={{fontSize:15,minWidth:22,marginTop:1}}>{ACT_ICONS[a.type]||"·"}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,color:C.text,lineHeight:1.5}}>{a.message}</div>
        <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{a.ts}</div>
      </div>
      {a.badge&&<Badge label={a.badge} color={a.badgeColor||C.orange} small/>}
    </div>
  ))}</div>;
}

// ─── STORM MAP ────────────────────────────────────────────────────────────────
function StormMap({storms,roofers}){
  const mapRef=useRef(null),inst=useRef(null);
  useEffect(()=>{
    if(inst.current||!window.L) return;
    const L=window.L;
    const map=L.map(mapRef.current,{center:[33.05,-96.72],zoom:9});
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map);
    inst.current=map;
    const sc={extreme:C.red,severe:C.orange,moderate:C.yellow};
    storms.filter(s=>s.lat&&s.lng).forEach(st=>{
      L.circleMarker([st.lat,st.lng],{radius:13,fillColor:sc[st.severity]||C.blue,color:"#fff",weight:2,opacity:1,fillOpacity:0.85}).addTo(map).bindPopup(`<b>${st.type}</b><br>${st.location}<br>ZIP: ${st.zip}<br>Severity: ${st.severity}<br>${st.date}`);
    });
    const zc=[C.blue,C.purple,C.green,C.orange,C.red];
    roofers.forEach((r,ri)=>r.territories.forEach(zip=>{
      const st=storms.find(s=>s.zip===zip&&s.lat&&s.lng);
      if(st) L.circle([st.lat,st.lng],{radius:8500,fillColor:zc[ri%zc.length],color:zc[ri%zc.length],weight:1,opacity:0.4,fillOpacity:0.06}).addTo(map).bindPopup(`<b>${r.name}</b><br>Territory: ${zip}`);
    }));
    return()=>{if(inst.current){inst.current.remove();inst.current=null;}};
  },[]);
  return <div style={{borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`}}>
    <div style={{...flex(10,"center","space-between"),padding:"12px 16px",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
      <span style={T.head(13,600)}>🗺 Storm Map</span>
      <div style={flex(12)}>
        {[{l:"Extreme",c:C.red},{l:"Severe",c:C.orange},{l:"Moderate",c:C.yellow}].map(x=>(
          <div key={x.l} style={flex(5)}><div style={{width:8,height:8,borderRadius:"50%",background:x.c}}/><span style={{fontSize:11,color:C.textSub}}>{x.l}</span></div>
        ))}
      </div>
    </div>
    <div ref={mapRef} style={{height:340,background:C.surface}}/>
  </div>;
}

// ─── AI AGENT ─────────────────────────────────────────────────────────────────
function AIAgent({roofers,leads,storms,apiKeys,onUpdate,context}){
  const[msgs,setMsgs]=useState([]),[input,setInput]=useState(""),[loading,setLoading]=useState(false);
  const bottomRef=useRef(null);
  useEffect(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}),[msgs]);

  const sys=`You are SkyShield Pro AI — a CRM assistant for a roofing lead platform by Ark Dynamics.
${context}
ROOFERS: ${JSON.stringify(roofers.map(r=>({id:r.id,name:r.name,plan:r.plan,status:r.status,territories:r.territories,leads:r.leads,booked:r.booked,revenue:r.revenue})))}
LEADS: ${JSON.stringify(leads.map(l=>({id:l.id,homeowner:l.homeowner,zip:l.zip,rooferId:l.rooferId,stormType:l.stormType,status:l.status,notes:l.notes})))}
STORMS: ${JSON.stringify(storms)}
Perform CRM actions by appending <ACTION>{"type":"...","payload":{...}}</ACTION> at the end of your message.
Actions: add_roofer, delete_roofer, edit_roofer, add_lead, delete_lead, edit_lead, lead_status, update_roofer_plan, update_roofer_status, update_lead_notes.
Always explain in plain English first, then include action blocks. Ask for clarification if ambiguous.`;

  async function send(){
    if(!input.trim()) return;
    const userMsg={role:"user",content:input},newMsgs=[...msgs,userMsg];
    setMsgs(newMsgs);setInput("");setLoading(true);
    try{
      const reply=await callClaude(newMsgs,sys,1400);
      const ar=/<ACTION>([\s\S]*?)<\/ACTION>/g;let m;
      while((m=ar.exec(reply))!==null){
        try{
          const{type,payload}=JSON.parse(m[1]);
          if(type==="add_roofer") onUpdate("add_roofer",{roofer:{id:"r"+Date.now(),revenue:0,leads:0,booked:0,status:"trial",inspectors:[],inspections:[],revenueLog:[],commSettings:{...DEFAULT_COMM},pin:"0000",...payload}});
          else if(type==="delete_roofer") onUpdate("delete_roofer",payload);
          else if(type==="edit_roofer") onUpdate("edit_roofer",payload);
          else if(type==="add_lead") onUpdate("add_lead",{lead:{id:"l"+Date.now(),conversations:[],notes:"",contactedAt:null,followupSent:false,...payload}});
          else if(type==="delete_lead") onUpdate("delete_lead",payload);
          else if(type==="edit_lead") onUpdate("edit_lead",payload);
          else if(type==="lead_status") onUpdate("lead_status",payload);
          else if(type==="update_roofer_plan") onUpdate("update_roofer_plan",payload);
          else if(type==="update_roofer_status") onUpdate("update_roofer_status",payload);
          else if(type==="update_lead_notes") onUpdate("update_lead_notes",payload);
        }catch(e){console.error("Action err",e);}
      }
      setMsgs([...newMsgs,{role:"assistant",content:reply.replace(/<ACTION>[\s\S]*?<\/ACTION>/g,"").trim()}]);
    }catch(e){setMsgs([...newMsgs,{role:"assistant",content:`Error: ${e.message}`}]);}
    setLoading(false);
  }

  return <div style={{display:"flex",flexDirection:"column",height:500,...card()}}>
    <div style={{marginBottom:10,padding:"8px 12px",background:C.greenDim,borderRadius:6,fontSize:12,color:C.green,border:`1px solid ${C.green}22`}}>
      🤖 AI Agent active — type commands like "Add Blue Sky Roofing in ZIP 75001 on Pro plan" or "Delete Tom Wiley's lead"
    </div>
    <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column",gap:8,padding:2,marginBottom:12}}>
      {msgs.length===0&&<div style={{textAlign:"center",color:C.textMuted,padding:40,fontSize:13,lineHeight:1.7}}>
        <div style={{fontSize:28,marginBottom:12}}>🤖</div>
        Try: <strong>"Show all pending leads"</strong> · <strong>"Add a roofer"</strong> · <strong>"Change Apex plan to Elite"</strong>
      </div>}
      {msgs.map((m,i)=><div key={i} style={{padding:"10px 14px",borderRadius:8,fontSize:13,lineHeight:1.6,background:m.role==="user"?C.orangeDim:C.surface,border:`1px solid ${m.role==="user"?C.orange+"33":C.border}`,alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"85%",whiteSpace:"pre-wrap"}}>{m.content}</div>)}
      {loading&&<div style={{padding:"10px 14px",borderRadius:8,background:C.surface,border:`1px solid ${C.border}`,alignSelf:"flex-start",fontSize:13,color:C.textMuted}}>⏳ Thinking...</div>}
      <div ref={bottomRef}/>
    </div>
    <div style={{...flex(8),borderTop:`1px solid ${C.border}`,paddingTop:10}}>
      <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
        placeholder="Command the AI agent..." style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"9px 12px",color:C.text,fontSize:13,outline:"none"}}/>
      <Btn variant="primary" onClick={send} disabled={loading||!input.trim()}>Send</Btn>
    </div>
  </div>;
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function ConversationModal({lead,roofer,onClose,onSendMessage,onUpdateNotes}){
  const[msg,setMsg]=useState(""),[notes,setNotes]=useState(lead.notes||""),[editing,setEditing]=useState(false);
  const bot=useRef(null);
  useEffect(()=>bot.current?.scrollIntoView({behavior:"smooth"}),[lead.conversations]);
  return <Modal title={`${lead.homeowner} — ${lead.phone}`} onClose={onClose} wide>
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{...flex(12,"center","space-between"),padding:"8px 12px",background:C.surface,borderRadius:7,flexWrap:"wrap",gap:6}}>
        <div style={flex(12)}><span style={{fontSize:12,color:C.textSub}}>📍 {lead.zip}</span><span style={{fontSize:12,color:C.textSub}}>⛈ {lead.stormType}</span></div>
        <StatusBadge status={lead.status}/>
      </div>
      <div style={{...card({padding:12})}}>
        <div style={{...flex(0,"center","space-between"),marginBottom:editing?8:0}}>
          <span style={T.label}>Notes</span>
          <Btn small variant="ghost" onClick={()=>{if(editing)onUpdateNotes(lead.id,notes);setEditing(!editing);}}>{editing?"Save Notes":"Edit"}</Btn>
        </div>
        {editing?<Textarea value={notes} onChange={setNotes} placeholder="Add notes about this lead..." rows={2}/>:<div style={{fontSize:13,color:notes?C.text:C.textMuted,lineHeight:1.6}}>{notes||"No notes yet — click Edit to add."}</div>}
      </div>
      <div style={{height:270,overflow:"auto",display:"flex",flexDirection:"column",gap:8,padding:2}}>
        {lead.conversations.length===0&&<div style={{textAlign:"center",color:C.textMuted,padding:40,fontSize:13}}>No messages yet.</div>}
        {lead.conversations.map((c,i)=><div key={i} style={{display:"flex",flexDirection:"column",alignItems:c.role==="ai"?"flex-start":"flex-end"}}>
          <div style={{padding:"8px 12px",borderRadius:8,fontSize:13,lineHeight:1.6,maxWidth:"82%",background:c.role==="ai"?C.blueDim:C.greenDim,border:`1px solid ${c.role==="ai"?C.blue+"28":C.green+"28"}`,whiteSpace:"pre-wrap"}}>{c.msg}</div>
          <div style={{fontSize:10,color:C.textMuted,marginTop:2}}>{c.role==="ai"?"AI Agent":"Lead"} · {c.ts}</div>
        </div>)}
        <div ref={bot}/>
      </div>
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
        {roofer&&!isWithinCommWindow(roofer.commSettings)&&<div style={{marginBottom:8}}><Badge label="Outside active comm hours" color={C.yellow} small/></div>}
        <div style={flex(8)}>
          <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&msg.trim()){onSendMessage(lead,msg);setMsg("");}}} placeholder="Type a message to send..." style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"9px 12px",color:C.text,fontSize:13,outline:"none"}}/>
          <Btn variant="primary" onClick={()=>{if(msg.trim()){onSendMessage(lead,msg);setMsg("");}}}>Send</Btn>
        </div>
      </div>
    </div>
  </Modal>;
}

function LogRevenueModal({lead,onClose,onSave}){
  const[amount,setAmount]=useState(""),[note,setNote]=useState("");
  return <Modal title="Log Won Job" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{padding:"10px 14px",background:C.greenDim,borderRadius:7,fontSize:13,border:`1px solid ${C.green}22`}}>Logging revenue for <strong>{lead.homeowner}</strong></div>
      <Input label="Job Amount ($)" type="number" value={amount} onChange={setAmount} placeholder="8500"/>
      <Input label="Note" value={note} onChange={setNote} placeholder="Full replacement, insurance claim"/>
      <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="success" onClick={()=>{if(!amount)return;onSave({id:"rv"+Date.now(),leadId:lead.id,homeowner:lead.homeowner,amount:Number(amount),date:new Date().toISOString().split("T")[0],note});onClose();}}>Log Revenue</Btn>
      </div>
    </div>
  </Modal>;
}

function CommSettingsPanel({roofer,onSave}){
  const[cfg,setCfg]=useState(roofer.commSettings||DEFAULT_COMM);
  const f=k=>v=>setCfg(p=>({...p,[k]:v}));
  const ft=k=>v=>setCfg(p=>({...p,templates:{...p.templates,[k]:v}}));
  function toggleDay(day){setCfg(p=>({...p,activeDays:p.activeDays.includes(day)?p.activeDays.filter(d=>d!==day):[...p.activeDays,day]}));}
  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <div style={card()}>
      <div style={{...T.head(14,600),marginBottom:14}}>⏰ Active Hours & Follow-Up</div>
      <div style={{...grid("1fr 1fr",12),marginBottom:14}}>
        <Input label="Start Time" type="time" value={cfg.activeHoursStart} onChange={f("activeHoursStart")}/>
        <Input label="End Time" type="time" value={cfg.activeHoursEnd} onChange={f("activeHoursEnd")}/>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{...T.label,marginBottom:8}}>Active Days</div>
        <div style={{...flex(6),flexWrap:"wrap"}}>
          {DAYS_OF_WEEK.map(d=><button key={d} onClick={()=>toggleDay(d)} style={{padding:"5px 11px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",background:cfg.activeDays.includes(d)?C.orange:C.surface,color:cfg.activeDays.includes(d)?"#fff":C.textSub,border:`1px solid ${cfg.activeDays.includes(d)?C.orange:C.border}`}}>{d}</button>)}
        </div>
      </div>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Follow-up after (days)" type="number" value={cfg.followupDays||2} onChange={v=>setCfg(p=>({...p,followupDays:Number(v)}))}/>
        <Input label="Mark cold after (days)" type="number" value={cfg.coldDays||5} onChange={v=>setCfg(p=>({...p,coldDays:Number(v)}))}/>
      </div>
      <div style={{marginTop:12,padding:"8px 12px",background:C.orangeDim,borderRadius:6,fontSize:12,color:C.textSub,border:`1px solid ${C.orange}22`}}>
        Status: <span style={{color:isWithinCommWindow(cfg)?C.green:C.red,fontWeight:600}}>{isWithinCommWindow(cfg)?"✓ Currently within active hours":"✗ Currently outside active hours"}</span>
      </div>
    </div>
    <div style={card()}>
      <div style={{...T.head(14,600),marginBottom:6}}>📝 Message Templates</div>
      <div style={{fontSize:12,color:C.textMuted,marginBottom:14}}>Variables: {"{{name}}"} {"{{zip}}"} {"{{storm}}"} {"{{company}}"} {"{{date}}"} {"{{time}}"} {"{{inspector}}"}</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Textarea label="Initial Outreach" value={cfg.templates.initial} onChange={ft("initial")} rows={3}/>
        <Textarea label="Follow-Up" value={cfg.templates.followup} onChange={ft("followup")} rows={3}/>
        <Textarea label="Booking Confirmation" value={cfg.templates.booking} onChange={ft("booking")} rows={3}/>
      </div>
    </div>
    <div style={flex(8,"center","flex-end")}>
      <Btn variant="primary" onClick={()=>onSave(cfg)}>Save Communication Settings</Btn>
    </div>
  </div>;
}

function AddRooferModal({onClose,onAdd}){
  const[f,setF]=useState({name:"",owner:"",email:"",phone:"",territories:"",plan:"Starter",pin:""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  return <Modal title="Add New Roofer" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Company Name" value={f.name} onChange={u("name")} placeholder="Apex Roofing Co"/>
      <Input label="Owner Name" value={f.owner} onChange={u("owner")} placeholder="John Smith"/>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Email" value={f.email} onChange={u("email")} type="email"/>
        <Input label="Phone" value={f.phone} onChange={u("phone")} placeholder="972-555-0100"/>
      </div>
      <Input label="Territories (comma-separated ZIPs)" value={f.territories} onChange={u("territories")} placeholder="75023, 75024, 75025"/>
      <div style={grid("1fr 1fr",12)}>
        <Select label="Plan" value={f.plan} onChange={u("plan")} options={["Starter","Pro","Elite"]}/>
        <Input label="Roofer PIN" value={f.pin} onChange={u("pin")} placeholder="e.g. 1234"/>
      </div>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{if(!f.name||!f.owner)return;onAdd({id:"r"+Date.now(),...f,territories:f.territories.split(",").map(z=>z.trim()).filter(Boolean),revenue:0,leads:0,booked:0,status:"trial",inspectors:[],inspections:[],revenueLog:[],commSettings:{...DEFAULT_COMM}});onClose();}}>Add Roofer</Btn>
      </div>
    </div>
  </Modal>;
}

function EditRooferModal({roofer,onClose,onSave}){
  const[f,setF]=useState({name:roofer.name,owner:roofer.owner,email:roofer.email,phone:roofer.phone,territories:roofer.territories.join(", "),plan:roofer.plan,status:roofer.status,pin:roofer.pin||""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  return <Modal title="Edit Roofer" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Company Name" value={f.name} onChange={u("name")}/>
      <Input label="Owner Name" value={f.owner} onChange={u("owner")}/>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Email" value={f.email} onChange={u("email")} type="email"/>
        <Input label="Phone" value={f.phone} onChange={u("phone")}/>
      </div>
      <Input label="Territories (ZIPs, comma-separated)" value={f.territories} onChange={u("territories")}/>
      <div style={grid("1fr 1fr 1fr",12)}>
        <Select label="Plan" value={f.plan} onChange={u("plan")} options={["Starter","Pro","Elite"]}/>
        <Select label="Status" value={f.status} onChange={u("status")} options={["active","trial","cancelled"]}/>
        <Input label="PIN" value={f.pin} onChange={u("pin")} placeholder="4-digit PIN"/>
      </div>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{if(!f.name||!f.owner)return;onSave({...roofer,...f,territories:f.territories.split(",").map(z=>z.trim()).filter(Boolean)});onClose();}}>Save Changes</Btn>
      </div>
    </div>
  </Modal>;
}

function EditLeadModal({lead,roofers,onClose,onSave}){
  const[f,setF]=useState({homeowner:lead.homeowner,phone:lead.phone,zip:lead.zip,stormType:lead.stormType,status:lead.status,rooferId:lead.rooferId,notes:lead.notes||""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  return <Modal title="Edit Lead" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Homeowner Name" value={f.homeowner} onChange={u("homeowner")}/>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Phone" value={f.phone} onChange={u("phone")}/>
        <Input label="ZIP" value={f.zip} onChange={u("zip")}/>
      </div>
      <Input label="Storm Type" value={f.stormType} onChange={u("stormType")}/>
      <div style={grid("1fr 1fr",12)}>
        <Select label="Status" value={f.status} onChange={u("status")} options={["pending","contacted","scheduled","won","cold"]}/>
        <Select label="Assigned Roofer" value={f.rooferId} onChange={u("rooferId")} options={roofers.map(r=>({value:r.id,label:r.name}))}/>
      </div>
      <Textarea label="Notes" value={f.notes} onChange={u("notes")} placeholder="Notes about this lead..." rows={2}/>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{onSave({...lead,...f});onClose();}}>Save Changes</Btn>
      </div>
    </div>
  </Modal>;
}

function AddInspectorModal({onClose,onAdd}){
  const[f,setF]=useState({name:"",phone:"",zones:""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  return <Modal title="Add Inspector" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Name" value={f.name} onChange={u("name")} placeholder="Jake Torres"/>
      <Input label="Phone" value={f.phone} onChange={u("phone")} placeholder="972-555-0200"/>
      <Input label="ZIP Zones (comma-separated)" value={f.zones} onChange={u("zones")} placeholder="75023, 75024"/>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{if(!f.name)return;onAdd({id:"i"+Date.now(),...f,zones:f.zones.split(",").map(z=>z.trim()).filter(Boolean)});onClose();}}>Add Inspector</Btn>
      </div>
    </div>
  </Modal>;
}

function AddInspectionModal({roofer,onClose,onAdd}){
  const[f,setF]=useState({client:"",address:"",date:"",time:"9:00 AM",inspector:""});
  const u=k=>v=>setF(p=>({...p,[k]:v}));
  const times=["8:00 AM","9:00 AM","10:00 AM","11:00 AM","12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM"];
  return <Modal title="Schedule Inspection" onClose={onClose}>
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <Input label="Client Name" value={f.client} onChange={u("client")} placeholder="John Smith"/>
      <Input label="Address" value={f.address} onChange={u("address")} placeholder="1234 Oak Ln, Plano TX 75023"/>
      <div style={grid("1fr 1fr",12)}>
        <Input label="Date" value={f.date} onChange={u("date")} type="date"/>
        <Select label="Time" value={f.time} onChange={u("time")} options={times}/>
      </div>
      <Select label="Inspector" value={f.inspector} onChange={u("inspector")} options={[{value:"",label:"Select inspector..."},...roofer.inspectors.map(i=>({value:i.name,label:i.name}))]}/>
      <div style={{...flex(8,"center","flex-end"),marginTop:6}}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>{if(!f.client||!f.date)return;onAdd({id:"ins"+Date.now(),...f,status:"scheduled"});onClose();}}>Schedule</Btn>
      </div>
    </div>
  </Modal>;
}

// ─── SCAN SCHEDULER ───────────────────────────────────────────────────────────
function ScanScheduler({scanSettings,onChange}){
  const[st,setSt]=useState(scanSettings);
  const upd=k=>v=>{const n={...st,[k]:v};setSt(n);onChange(n);};
  return <div style={card()}>
    <div style={{...T.head(13,600),marginBottom:14}}>⚡ Auto Storm Scan Schedule</div>
    <div style={grid("1fr 1fr",12)}>
      <Select label="Frequency" value={st.interval} onChange={upd("interval")} options={SCAN_INTERVALS}/>
      <Input label="Daily Start Time" type="time" value={st.startTime} onChange={upd("startTime")}/>
    </div>
    <div style={{marginTop:10,padding:"8px 12px",background:C.orangeDim,borderRadius:6,fontSize:12,color:C.textSub,border:`1px solid ${C.orange}22`}}>
      {st.interval==="manual"?"⚠ Manual only — use Run Scan button":`✓ ${SCAN_INTERVALS.find(i=>i.value===st.interval)?.label} starting at ${st.startTime}`}
      {st.lastScan&&<span style={{marginLeft:8,color:C.textMuted}}>· Last: {st.lastScan}</span>}
    </div>
  </div>;
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({roofers,onAdminLogin,onRooferLogin}){
  const[mode,setMode]=useState("admin"),[pin,setPin]=useState(""),[selectedId,setSelectedId]=useState(roofers[0]?.id||""),[error,setError]=useState("");
  function handleLogin(){
    if(mode==="admin"){if(pin==="admin"||pin==="1111"){onAdminLogin();return;}setError("Invalid admin PIN. Try: admin");}
    else{const r=roofers.find(x=>x.id===selectedId);if(r&&(r.pin||"0000")===pin){onRooferLogin(r);return;}setError("Incorrect PIN for this company.");}
  }
  return <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:380}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:56,height:56,borderRadius:14,background:`linear-gradient(135deg,${C.orange},#c0392b)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 16px"}}>⛈</div>
        <div style={{...T.head(24,700),letterSpacing:"-0.02em"}}>Sky<span style={{color:C.orange}}>Shield</span> Pro</div>
        <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginTop:6}}>Powered by Ark Dynamics</div>
      </div>
      <div style={card({padding:24})}>
        <div style={{display:"flex",gap:4,marginBottom:20,background:C.surface,borderRadius:8,padding:4}}>
          {["admin","roofer"].map(m=><button key={m} onClick={()=>{setMode(m);setPin("");setError("");}} style={{flex:1,padding:"8px",borderRadius:6,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,background:mode===m?C.orange:C.surface,color:mode===m?"#fff":C.textMuted,transition:"all 0.15s"}}>{m==="admin"?"Admin Login":"Roofer Login"}</button>)}
        </div>
        {mode==="roofer"&&<div style={{marginBottom:14}}><Select label="Select Your Company" value={selectedId} onChange={setSelectedId} options={roofers.map(r=>({value:r.id,label:r.name}))}/></div>}
        <div style={{marginBottom:14}}><Input label="PIN" type="password" value={pin} onChange={v=>{setPin(v);setError("");}} placeholder={mode==="admin"?"Admin PIN":"4-digit PIN"}/></div>
        {error&&<div style={{color:C.red,fontSize:12,marginBottom:12,padding:"7px 10px",background:C.redDim,borderRadius:6}}>{error}</div>}
        <Btn variant="primary" onClick={handleLogin} style={{width:"100%",padding:"10px",fontSize:14}}>Sign In</Btn>
        <div style={{marginTop:14,padding:"10px 12px",background:C.surface,borderRadius:6,fontSize:11,color:C.textMuted,lineHeight:1.7}}>
          <strong style={{color:C.textSub}}>Demo credentials:</strong><br/>
          Admin PIN: <code>admin</code> &nbsp;·&nbsp; Roofer PINs: <code>1234</code> / <code>5678</code> / <code>9999</code>
        </div>
      </div>
    </div>
  </div>;
}

// ─── LEAD ROW ─────────────────────────────────────────────────────────────────
function LeadRow({lead,roofers,onSMS,onBook,onEdit,onDelete,onViewConvo,onLogRevenue,showRoofer}){
  const roofer=roofers.find(r=>r.id===lead.rooferId);
  const unread=(lead.conversations||[]).filter(c=>c.role==="lead").length;
  return <TR>
    <TD bold sub={lead.notes?"📝 "+lead.notes.slice(0,50)+(lead.notes.length>50?"...":""):undefined}>{lead.homeowner}</TD>
    <TD dim>{lead.phone}</TD>
    <TD>{lead.zip}</TD>
    {showRoofer&&<TD dim>{roofer?.name||"—"}</TD>}
    <TD dim>{lead.stormType}</TD>
    <TD><StatusBadge status={lead.status}/></TD>
    <TD nowrap>
      <div style={{...flex(4),flexWrap:"wrap"}}>
        <button onClick={()=>onViewConvo(lead)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,position:"relative",padding:"3px 5px",lineHeight:1}}>
          💬{unread>0&&<span style={{position:"absolute",top:-2,right:-2,background:C.orange,color:"#fff",borderRadius:"50%",width:13,height:13,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{unread}</span>}
        </button>
        {lead.status==="pending"&&<Btn small variant="info" onClick={()=>onSMS(lead)}>SMS</Btn>}
        {lead.status==="contacted"&&<Btn small variant="success" onClick={()=>onBook(lead)}>Book</Btn>}
        {lead.status==="scheduled"&&<Btn small variant="purple" onClick={()=>onLogRevenue(lead)}>💰 Won</Btn>}
        <Btn small variant="default" onClick={()=>onEdit(lead)}>✏</Btn>
        <Btn small variant="danger" onClick={()=>{if(window.confirm("Delete this lead?"))onDelete(lead);}}>🗑</Btn>
      </div>
    </TD>
  </TR>;
}

// ─── ROOFER DASHBOARD ─────────────────────────────────────────────────────────
function RooferDashboard({roofer,leads,apiKeys,onUpdate,addActivity}){
  const[tab,setTab]=useState("Overview");
  const[showAddInspector,setShowAddInspector]=useState(false);
  const[showAddInspection,setShowAddInspection]=useState(false);
  const[editingLead,setEditingLead]=useState(null);
  const[viewingConvo,setViewingConvo]=useState(null);
  const[loggingRevenue,setLoggingRevenue]=useState(null);
  const[leadFilter,setLeadFilter]=useState("all");
  const[newZip,setNewZip]=useState("");

  const myLeads=leads.filter(l=>l.rooferId===roofer.id);
  const pending=myLeads.filter(l=>l.status==="pending");
  const contacted=myLeads.filter(l=>l.status==="contacted");
  const scheduled=myLeads.filter(l=>l.status==="scheduled");
  const won=myLeads.filter(l=>l.status==="won");
  const filteredLeads=leadFilter==="all"?myLeads:myLeads.filter(l=>l.status===leadFilter);
  const insStats=INSPECTION_STATUSES.reduce((acc,st)=>({...acc,[st]:roofer.inspections.filter(i=>i.status===st).length}),{});

  async function smsLead(lead){
    const comm=roofer.commSettings||DEFAULT_COMM;
    if(!isWithinCommWindow(comm)&&!window.confirm("Outside active hours. Send anyway?")) return;
    const msg=fillTemplate(comm.templates.initial,{name:lead.homeowner,zip:lead.zip,storm:lead.stormType,company:roofer.name});
    if(apiKeys.twilio?.sid) await sendTwilioSMS(apiKeys.twilio,lead.phone,msg);
    onUpdate("lead_status",{leadId:lead.id,status:"contacted"});
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
    onUpdate("set_contacted_at",{leadId:lead.id,ts:new Date().toISOString().split("T")[0]});
    addActivity({type:"sms",message:`SMS sent to ${lead.homeowner} (${roofer.name})`,badge:"contacted",badgeColor:C.blue});
    alert(`SMS sent to ${lead.homeowner}:\n\n${msg}`);
  }
  function bookLead(lead){
    const inspector=roofer.inspectors.find(i=>i.zones.includes(lead.zip))||roofer.inspectors[0];
    const d=new Date();d.setDate(d.getDate()+2);
    const dateStr=d.toISOString().split("T")[0];
    const ins={id:"ins"+Date.now(),client:lead.homeowner,address:lead.zip,date:dateStr,time:"10:00 AM",inspector:inspector?.name||"TBD",status:"scheduled"};
    onUpdate("book_lead",{leadId:lead.id,rooferId:roofer.id,inspection:ins});
    const comm=roofer.commSettings||DEFAULT_COMM;
    const msg=fillTemplate(comm.templates.booking,{name:lead.homeowner,date:dateStr,time:"10:00 AM",inspector:inspector?.name||"TBD",company:roofer.name});
    if(apiKeys.twilio?.sid) sendTwilioSMS(apiKeys.twilio,lead.phone,msg);
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
    addActivity({type:"booking",message:`Inspection booked for ${lead.homeowner}`,badge:"scheduled",badgeColor:C.green});
  }
  function sendManualMessage(lead,msg){
    if(apiKeys.twilio?.sid) sendTwilioSMS(apiKeys.twilio,lead.phone,msg);
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
  }
  function logRevenue(entry){
    onUpdate("log_revenue",{rooferId:roofer.id,entry});
    onUpdate("lead_status",{leadId:entry.leadId,status:"won"});
    addActivity({type:"revenue",message:`$${entry.amount.toLocaleString()} logged — ${entry.homeowner}`,badge:`$${entry.amount.toLocaleString()}`,badgeColor:C.green});
  }

  const revByMonth=(roofer.revenueLog||[]).reduce((acc,r)=>{const mo=r.date?.slice(0,7)||"?";acc[mo]=(acc[mo]||0)+r.amount;return acc;},{});
  const revChart=Object.entries(revByMonth).slice(-6).map(([label,value])=>({label:label.slice(5),value,color:C.green}));
  const groupedIns=roofer.inspections.reduce((acc,ins)=>{(acc[ins.date]||(acc[ins.date]=[])).push(ins);return acc;},{});
  const ctx=`Roofer: ${roofer.name}. Leads: ${myLeads.length}, Booked: ${scheduled.length}, Won: ${won.length}, Revenue: $${roofer.revenue.toLocaleString()}`;

  return <div>
    {showAddInspector&&<AddInspectorModal onClose={()=>setShowAddInspector(false)} onAdd={insp=>onUpdate("add_inspector",{rooferId:roofer.id,inspector:insp})}/>}
    {showAddInspection&&<AddInspectionModal roofer={roofer} onClose={()=>setShowAddInspection(false)} onAdd={ins=>onUpdate("add_inspection",{rooferId:roofer.id,inspection:ins})}/>}
    {editingLead&&<EditLeadModal lead={editingLead} roofers={[roofer]} onClose={()=>setEditingLead(null)} onSave={l=>onUpdate("edit_lead",{lead:l})}/>}
    {viewingConvo&&<ConversationModal lead={viewingConvo} roofer={roofer} onClose={()=>setViewingConvo(null)} onSendMessage={sendManualMessage} onUpdateNotes={(id,notes)=>onUpdate("update_lead_notes",{leadId:id,notes})}/>}
    {loggingRevenue&&<LogRevenueModal lead={loggingRevenue} onClose={()=>setLoggingRevenue(null)} onSave={logRevenue}/>}

    <Tabs tabs={["Overview","Leads","Calendar","Revenue","Inspectors","Territories","Comm Settings","AI Agent"]} active={tab} onChange={setTab}/>

    {tab==="Overview"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
        <StatCard label="Total Leads" value={myLeads.length} color={C.orange} icon="👥"/>
        <StatCard label="Booked" value={scheduled.length} color={C.blue} icon="📅"/>
        <StatCard label="Won Jobs" value={won.length} color={C.green} icon="✅"/>
        <StatCard label="Revenue" value={`$${roofer.revenue.toLocaleString()}`} color={C.purple} icon="💰"/>
        <StatCard label="Conv. Rate" value={`${myLeads.length>0?Math.round(won.length/myLeads.length*100):0}%`} color={C.yellow} icon="📈"/>
      </div>
      <div style={grid("1fr 1fr",16)}>
        <div style={card()}>
          <div style={{...T.head(13,600),marginBottom:14}}>Lead Pipeline</div>
          <MiniBarChart data={[{label:"Total",value:myLeads.length,color:C.orange},{label:"Contacted",value:contacted.length,color:C.blue},{label:"Booked",value:scheduled.length,color:C.purple},{label:"Won",value:won.length,color:C.green}]}/>
        </div>
        <div style={card()}>
          <div style={{...T.head(13,600),marginBottom:14}}>Inspection Outcomes</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {INSPECTION_STATUSES.map(st=><div key={st} style={{...flex(0,"center","space-between")}}>
              <Badge label={st} color={INS_STATUS_COLORS[st]} small/>
              <span style={{fontSize:15,fontWeight:700,color:INS_STATUS_COLORS[st]}}>{insStats[st]||0}</span>
            </div>)}
          </div>
        </div>
      </div>
      <div style={card()}>
        <div style={{...T.head(13,600),marginBottom:14}}>Upcoming Inspections</div>
        {roofer.inspections.filter(i=>i.status==="scheduled").length===0
          ?<div style={{color:C.textMuted,fontSize:13}}>No scheduled inspections.</div>
          :roofer.inspections.filter(i=>i.status==="scheduled").slice(0,5).map(ins=><div key={ins.id} style={{...flex(0,"center","space-between"),padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
            <div><div style={{fontSize:13,fontWeight:600}}>{ins.client}</div><div style={{fontSize:12,color:C.textSub,marginTop:2}}>{ins.address}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:12,color:C.orange,fontWeight:500}}>{ins.date} · {ins.time}</div><div style={{fontSize:12,color:C.textMuted}}>{ins.inspector}</div></div>
          </div>)}
      </div>
    </div>}

    {tab==="Leads"&&<div>
      <div style={{...flex(0,"center","space-between"),marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{...flex(6),flexWrap:"wrap"}}>
          {["all","pending","contacted","scheduled","won","cold"].map(f=><Btn key={f} small variant={leadFilter===f?"primary":"default"} onClick={()=>setLeadFilter(f)}>{f.charAt(0).toUpperCase()+f.slice(1)}</Btn>)}
        </div>
        <div style={flex(6)}>
          {pending.length>0&&<Btn variant="info" small onClick={()=>pending.forEach(l=>smsLead(l))}>SMS All Pending ({pending.length})</Btn>}
          <Btn variant="default" small onClick={()=>exportToCSV(filteredLeads,[roofer],roofer.name+"-leads.csv")}>⬇ CSV</Btn>
        </div>
      </div>
      <TableWrap headers={["Homeowner","Phone","ZIP","Storm","Status","Actions"]} empty={filteredLeads.length===0?"No leads match this filter.":undefined}>
        {filteredLeads.map(l=><LeadRow key={l.id} lead={l} roofers={[roofer]} onSMS={smsLead} onBook={bookLead} onEdit={setEditingLead} onDelete={l=>onUpdate("delete_lead",{leadId:l.id})} onViewConvo={setViewingConvo} onLogRevenue={setLoggingRevenue} showRoofer={false}/>)}
      </TableWrap>
    </div>}

    {tab==="Calendar"&&<div>
      <div style={{...flex(0,"center","flex-end"),marginBottom:14}}><Btn variant="primary" onClick={()=>setShowAddInspection(true)}>+ Add Inspection</Btn></div>
      {Object.keys(groupedIns).length===0?<div style={{...card({textAlign:"center",padding:40,color:C.textMuted,fontSize:13})}}>No inspections scheduled.</div>:Object.entries(groupedIns).sort().map(([date,insps])=><div key={date} style={{marginBottom:16}}>
        <div style={{...T.head(12,600),color:C.orange,marginBottom:8}}>{date}</div>
        {insps.map(ins=><div key={ins.id} style={{...card({marginBottom:8,padding:"14px 16px"})}}>
          <div style={{...flex(0,"flex-start","space-between"),gap:12}}>
            <div><div style={{fontSize:13,fontWeight:600}}>{ins.client}</div><div style={{fontSize:12,color:C.textSub,marginTop:2}}>{ins.address}</div></div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
              <div style={{fontSize:12,color:C.orange,fontWeight:500}}>{ins.time} · {ins.inspector}</div>
              <select value={ins.status} onChange={e=>onUpdate("update_inspection_status",{rooferId:roofer.id,inspectionId:ins.id,status:e.target.value})} style={{background:C.surface,border:`1px solid ${INS_STATUS_COLORS[ins.status]||C.border}`,borderRadius:5,padding:"3px 8px",color:INS_STATUS_COLORS[ins.status]||C.text,fontSize:11,cursor:"pointer"}}>
                {INSPECTION_STATUSES.map(st=><option key={st} value={st}>{st}</option>)}
              </select>
            </div>
          </div>
        </div>)}
      </div>)}
    </div>}

    {tab==="Revenue"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
        <StatCard label="Total Revenue" value={`$${roofer.revenue.toLocaleString()}`} color={C.green} icon="💰"/>
        <StatCard label="Won Jobs" value={won.length} color={C.purple} icon="✅"/>
        <StatCard label="Avg Job Value" value={roofer.revenueLog?.length?`$${Math.round(roofer.revenueLog.reduce((s,r)=>s+r.amount,0)/roofer.revenueLog.length).toLocaleString()}`:"—"} color={C.orange} icon="📊"/>
      </div>
      {revChart.length>0&&<div style={card()}><div style={{...T.head(13,600),marginBottom:14}}>Revenue by Month</div><MiniBarChart data={revChart}/></div>}
      <div style={card({padding:0,overflow:"hidden"})}>
        <div style={{...flex(0,"center","space-between"),padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
          <span style={T.head(13,600)}>Revenue Log</span>
          <Btn small onClick={()=>{const csv="Homeowner,Amount,Date,Note\n"+(roofer.revenueLog||[]).map(r=>`"${r.homeowner}",$${r.amount},"${r.date}","${r.note||""}"`).join("\n");const b=new Blob([csv],{type:"text/csv"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=roofer.name+"-revenue.csv";a.click();}}>⬇ Export CSV</Btn>
        </div>
        <TableWrap headers={["Homeowner","Amount","Date","Note"]} empty={(!roofer.revenueLog||roofer.revenueLog.length===0)?"No revenue logged yet. Use the 💰 Won button on a scheduled lead.":undefined}>
          {(roofer.revenueLog||[]).map(r=><TR key={r.id}>
            <TD bold>{r.homeowner}</TD>
            <TD style={{color:C.green,fontWeight:700}}>${r.amount.toLocaleString()}</TD>
            <TD dim>{r.date}</TD>
            <TD dim>{r.note||"—"}</TD>
          </TR>)}
        </TableWrap>
      </div>
    </div>}

    {tab==="Inspectors"&&<div>
      <div style={{...flex(0,"center","flex-end"),marginBottom:14}}><Btn variant="primary" onClick={()=>setShowAddInspector(true)}>+ Add Inspector</Btn></div>
      <TableWrap headers={["Name","Phone","ZIP Zones"]} empty={roofer.inspectors.length===0?"No inspectors added yet.":undefined}>
        {roofer.inspectors.map(ins=><TR key={ins.id}>
          <TD bold>{ins.name}</TD>
          <TD dim>{ins.phone}</TD>
          <TD><div style={{...flex(6),flexWrap:"wrap"}}>{ins.zones.map(z=><Badge key={z} label={z} color={C.blue} small/>)}</div></TD>
        </TR>)}
      </TableWrap>
    </div>}

    {tab==="Territories"&&<div>
      <div style={{...flex(8),marginBottom:14}}>
        <input value={newZip} onChange={e=>setNewZip(e.target.value)} placeholder="Enter ZIP code..." style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 12px",color:C.text,fontSize:13,outline:"none",width:200}}/>
        <Btn variant="primary" onClick={()=>{if(newZip.trim()){onUpdate("add_territory",{rooferId:roofer.id,zip:newZip.trim()});setNewZip("");}}}>Add ZIP</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:10}}>
        {roofer.territories.map(zip=><div key={zip} style={{...card({display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px"})}}><span style={{fontSize:13,fontWeight:600}}>{zip}</span><button onClick={()=>onUpdate("remove_territory",{rooferId:roofer.id,zip})} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:18,lineHeight:1}}>×</button></div>)}
      </div>
    </div>}

    {tab==="Comm Settings"&&<CommSettingsPanel roofer={roofer} onSave={settings=>onUpdate("update_comm_settings",{rooferId:roofer.id,settings})}/>}
    {tab==="AI Agent"&&<AIAgent roofers={[roofer]} leads={myLeads} storms={[]} apiKeys={apiKeys} onUpdate={onUpdate} context={ctx}/>}
  </div>;
}

// ─── COMMAND CENTER ───────────────────────────────────────────────────────────
function CommandCenter({roofers,leads,storms,apiKeys,onUpdate,onSelectRoofer,scanSettings,onScanSettingsChange,activities,addActivity}){
  const[tab,setTab]=useState("Overview");
  const[showAddRoofer,setShowAddRoofer]=useState(false);
  const[editingRoofer,setEditingRoofer]=useState(null);
  const[editingLead,setEditingLead]=useState(null);
  const[viewingConvo,setViewingConvo]=useState(null);
  const[loggingRevenue,setLoggingRevenue]=useState(null);
  const[scanStatus,setScanStatus]=useState("");
  const[manualZip,setManualZip]=useState("");
  const[statusFilter,setStatusFilter]=useState("all");
  const[rooferFilter,setRooferFilter]=useState("all");
  const[fetchingTwilio,setFetchingTwilio]=useState(false);

  const totalMRR=roofers.filter(r=>r.status==="active").reduce((a,r)=>a+PLAN_PRICES[r.plan],0);
  const pending=leads.filter(l=>l.status==="pending");

  const runScan=useCallback(async(auto=false)=>{
    if(!auto) setScanStatus("Scanning...");
    if(apiKeys.weather){
      try{
        const zips=[...new Set(roofers.flatMap(r=>r.territories))];
        let found=0;
        for(const zip of zips.slice(0,5)){
          const data=await fetchWeatherAlerts(apiKeys.weather,zip);
          (data.alerts?.alert||[]).forEach(a=>{
            const desc=(a.headline||"").toLowerCase();
            if(["hail","tornado","wind","thunderstorm","severe"].some(k=>desc.includes(k))){
              onUpdate("add_storm",{storm:{id:"s"+Date.now()+zip,type:"Weather Alert",location:zip,zip,severity:"severe",date:new Date().toISOString().split("T")[0],processed:false,lat:null,lng:null}});
              found++;
            }
          });
        }
        if(found>0) addActivity({type:"storm",message:`Auto-scan found ${found} new storm alert(s)`,badge:`${found} new`,badgeColor:C.red});
        onScanSettingsChange({...scanSettings,lastScan:new Date().toLocaleString()});
        if(!auto) setScanStatus("✓ Scan complete");
      }catch(e){if(!auto) setScanStatus("Error: "+e.message);}
    } else if(!auto) setScanStatus("⚠ WeatherAPI key not configured.");
    if(!auto) setTimeout(()=>setScanStatus(""),3000);
  },[roofers,apiKeys,scanSettings,onUpdate,onScanSettingsChange,addActivity]);

  useEffect(()=>{
    if(scanSettings.interval==="manual") return;
    const ms={daily:86400000,"2h":7200000,"1h":3600000,"30m":1800000}[scanSettings.interval];
    if(!ms) return;
    const id=setInterval(()=>runScan(true),ms);
    return()=>clearInterval(id);
  },[scanSettings.interval,runScan]);

  // Follow-up automation
  useEffect(()=>{
    const check=()=>{
      const now=new Date();
      leads.forEach(lead=>{
        if(lead.status!=="contacted"||lead.followupSent||!lead.contactedAt) return;
        const roofer=roofers.find(r=>r.id===lead.rooferId);
        const comm=roofer?.commSettings||DEFAULT_COMM;
        const days=Math.floor((now-new Date(lead.contactedAt))/86400000);
        if(days>=(comm.followupDays||2)){
          const msg=fillTemplate(comm.templates.followup,{name:lead.homeowner,zip:lead.zip,storm:lead.stormType,company:roofer?.name||"us"});
          if(apiKeys.twilio?.sid) sendTwilioSMS(apiKeys.twilio,lead.phone,msg);
          onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
          onUpdate("mark_followup_sent",{leadId:lead.id});
          addActivity({type:"followup",message:`Auto follow-up sent to ${lead.homeowner}`,badge:"follow-up",badgeColor:C.yellow});
        }
        if(days>=(comm.coldDays||5)&&lead.status==="contacted"){
          onUpdate("lead_status",{leadId:lead.id,status:"cold"});
          addActivity({type:"system",message:`${lead.homeowner} marked cold — no response after ${comm.coldDays||5} days`});
        }
      });
    };
    const id=setInterval(check,3600000);
    check();
    return()=>clearInterval(id);
  },[leads,roofers,apiKeys]);

  async function fetchTwilioIncoming(){
    if(!apiKeys.twilio?.sid) return;
    setFetchingTwilio(true);
    try{
      const enc=btoa(apiKeys.twilio.sid+":"+apiKeys.twilio.token);
      const res=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${apiKeys.twilio.sid}/Messages.json?PageSize=20&Direction=inbound`,{headers:{"Authorization":"Basic "+enc}});
      const data=await res.json();
      (data.messages||[]).forEach(m=>{
        const cp=m.from.replace(/\D/g,"");
        const lead=leads.find(l=>l.phone.replace(/\D/g,"")===cp);
        if(lead&&!lead.conversations.some(c=>c.ts===m.date_sent&&c.role==="lead")){
          onUpdate("add_conversation",{leadId:lead.id,entry:{role:"lead",msg:m.body,ts:m.date_sent}});
          addActivity({type:"sms",message:`Reply from ${lead.homeowner}: "${m.body.slice(0,60)}"`,badge:"reply",badgeColor:C.green});
        }
      });
    }catch(e){}
    setFetchingTwilio(false);
  }

  const filteredLeads=leads.filter(l=>(statusFilter==="all"||l.status===statusFilter)&&(rooferFilter==="all"||l.rooferId===rooferFilter));

  async function smsLead(lead){
    const roofer=roofers.find(r=>r.id===lead.rooferId);
    const comm=roofer?.commSettings||DEFAULT_COMM;
    if(!isWithinCommWindow(comm)&&!window.confirm("Outside active hours. Send anyway?")) return;
    const msg=fillTemplate(comm.templates.initial,{name:lead.homeowner,zip:lead.zip,storm:lead.stormType,company:roofer?.name||"us"});
    if(apiKeys.twilio?.sid) await sendTwilioSMS(apiKeys.twilio,lead.phone,msg);
    onUpdate("lead_status",{leadId:lead.id,status:"contacted"});
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
    onUpdate("set_contacted_at",{leadId:lead.id,ts:new Date().toISOString().split("T")[0]});
    addActivity({type:"sms",message:`SMS sent to ${lead.homeowner}`,badge:"contacted",badgeColor:C.blue});
    alert(`SMS to ${lead.homeowner}:\n\n${msg}`);
  }
  function bookLead(lead){
    const roofer=roofers.find(r=>r.id===lead.rooferId);
    const inspector=roofer?.inspectors.find(i=>i.zones.includes(lead.zip))||roofer?.inspectors[0];
    const d=new Date();d.setDate(d.getDate()+2);
    const dateStr=d.toISOString().split("T")[0];
    const ins={id:"ins"+Date.now(),client:lead.homeowner,address:lead.zip,date:dateStr,time:"10:00 AM",inspector:inspector?.name||"TBD",status:"scheduled"};
    onUpdate("book_lead",{leadId:lead.id,rooferId:lead.rooferId,inspection:ins});
    const comm=roofer?.commSettings||DEFAULT_COMM;
    const msg=fillTemplate(comm.templates.booking,{name:lead.homeowner,date:dateStr,time:"10:00 AM",inspector:inspector?.name||"TBD",company:roofer?.name||"us"});
    if(apiKeys.twilio?.sid) sendTwilioSMS(apiKeys.twilio,lead.phone,msg);
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
    addActivity({type:"booking",message:`Inspection booked for ${lead.homeowner} on ${dateStr}`,badge:"booked",badgeColor:C.green});
  }
  function sendManualMessage(lead,msg){
    const roofer=roofers.find(r=>r.id===lead.rooferId);
    if(apiKeys.twilio?.sid&&roofer) sendTwilioSMS(apiKeys.twilio,lead.phone,msg);
    onUpdate("add_conversation",{leadId:lead.id,entry:{role:"ai",msg,ts:new Date().toLocaleString()}});
  }
  function logRevenue(entry){
    const lead=leads.find(l=>l.id===entry.leadId);
    onUpdate("log_revenue",{rooferId:lead?.rooferId,entry});
    onUpdate("lead_status",{leadId:entry.leadId,status:"won"});
    addActivity({type:"revenue",message:`$${entry.amount.toLocaleString()} logged — ${entry.homeowner}`,badge:`$${entry.amount.toLocaleString()}`,badgeColor:C.green});
  }

  const ctx=`Platform: ${roofers.length} roofers, ${leads.length} leads, ${pending.length} pending, ${storms.length} storms, $${totalMRR.toLocaleString()} MRR.`;

  return <div>
    {showAddRoofer&&<AddRooferModal onClose={()=>setShowAddRoofer(false)} onAdd={r=>{onUpdate("add_roofer",{roofer:r});addActivity({type:"roofer",message:`New roofer: ${r.name}`,badge:r.plan,badgeColor:PLAN_COLORS[r.plan]});}}/>}
    {editingRoofer&&<EditRooferModal roofer={editingRoofer} onClose={()=>setEditingRoofer(null)} onSave={r=>onUpdate("edit_roofer",{roofer:r})}/>}
    {editingLead&&<EditLeadModal lead={editingLead} roofers={roofers} onClose={()=>setEditingLead(null)} onSave={l=>onUpdate("edit_lead",{lead:l})}/>}
    {viewingConvo&&<ConversationModal lead={viewingConvo} roofer={roofers.find(r=>r.id===viewingConvo.rooferId)} onClose={()=>setViewingConvo(null)} onSendMessage={sendManualMessage} onUpdateNotes={(id,notes)=>onUpdate("update_lead_notes",{leadId:id,notes})}/>}
    {loggingRevenue&&<LogRevenueModal lead={loggingRevenue} onClose={()=>setLoggingRevenue(null)} onSave={logRevenue}/>}

    <Tabs tabs={["Overview","Storms","Roofers","All Leads","Conversations","Activity","AI Agent"]} active={tab} onChange={setTab}/>

    {tab==="Overview"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
        <StatCard label="Monthly Revenue" value={`$${totalMRR.toLocaleString()}`} color={C.green} icon="💰"/>
        <StatCard label="Active Clients" value={roofers.filter(r=>r.status==="active").length} color={C.orange} icon="🏢"/>
        <StatCard label="Total Leads" value={leads.length} color={C.blue} icon="👥"/>
        <StatCard label="Inspections" value={leads.filter(l=>l.status==="scheduled").length} color={C.purple} icon="📅"/>
        <StatCard label="Storms" value={storms.length} color={C.red} icon="⛈"/>
      </div>
      <ScanScheduler scanSettings={scanSettings} onChange={onScanSettingsChange}/>
      <div style={grid("1fr 1fr",16)}>
        <div style={card()}>
          <div style={{...T.head(13,600),marginBottom:14}}>⛈ Recent Storms</div>
          {storms.slice(0,4).map(st=><div key={st.id} style={{...flex(12,"center","space-between"),padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
            <div><div style={{fontSize:13,fontWeight:500}}>{st.type} — {st.location}</div><div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{st.date} · ZIP {st.zip}</div></div>
            <SeverityBadge severity={st.severity}/>
          </div>)}
          {storms.length===0&&<div style={{color:C.textMuted,fontSize:13}}>No storms detected yet.</div>}
        </div>
        <div style={card()}>
          <div style={{...T.head(13,600),marginBottom:14}}>🏢 Roofer Performance</div>
          {roofers.map(r=><div key={r.id} onClick={()=>onSelectRoofer(r)} style={{...flex(12,"center","space-between"),padding:"9px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background=C.cardHov} onMouseLeave={e=>e.currentTarget.style.background=""}>
            <div><div style={{fontSize:13,fontWeight:500}}>{r.name}</div><div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{r.leads} leads · {r.booked} booked · ${(r.revenue/1000).toFixed(0)}k</div></div>
            <div style={flex(6)}><Badge label={r.plan} color={PLAN_COLORS[r.plan]} small/><StatusBadge status={r.status}/></div>
          </div>)}
        </div>
      </div>
      <div style={card()}>
        <div style={{...T.head(13,600),marginBottom:14}}>📋 Recent Activity</div>
        <ActivityFeed activities={activities.slice(0,8)}/>
      </div>
      <StormMap storms={storms} roofers={roofers}/>
    </div>}

    {tab==="Storms"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <ScanScheduler scanSettings={scanSettings} onChange={onScanSettingsChange}/>
      <div style={{...flex(0,"center","space-between"),flexWrap:"wrap",gap:8}}>
        <div style={flex(8)}>
          <Btn variant="primary" onClick={()=>runScan(false)}>⚡ Run Scan Now</Btn>
          {scanStatus&&<span style={{fontSize:12,color:C.textSub}}>{scanStatus}</span>}
        </div>
        <div style={flex(8)}>
          <input value={manualZip} onChange={e=>setManualZip(e.target.value)} placeholder="Enter ZIP..." style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 12px",color:C.text,fontSize:13,outline:"none",width:130}}/>
          <Btn variant="info" onClick={()=>{if(!manualZip.trim())return;const zip=manualZip.trim(),r=roofers.find(x=>x.territories.includes(zip));if(r){onUpdate("add_lead",{lead:{id:"l"+Date.now(),homeowner:"Storm Lead - "+zip,phone:"000-000-0000",zip,rooferId:r.id,stormType:"Manual",status:"pending",conversations:[],notes:"",contactedAt:null,followupSent:false}});addActivity({type:"lead",message:`Manual lead for ${r.name} in ZIP ${zip}`});alert("Lead created for "+r.name);}else alert("No roofer found for ZIP "+zip);setManualZip("");}}>+ Campaign</Btn>
        </div>
      </div>
      <TableWrap headers={["Type","Location","ZIP","Severity","Date","Status","Action"]}>
        {storms.map(st=><TR key={st.id}>
          <TD bold>{st.type}</TD>
          <TD>{st.location}</TD>
          <TD>{st.zip}</TD>
          <TD><SeverityBadge severity={st.severity}/></TD>
          <TD dim>{st.date}</TD>
          <TD><Badge label={st.processed?"processed":"new"} color={st.processed?C.green:C.orange} small/></TD>
          <TD>{!st.processed&&<Btn small variant="primary" onClick={()=>{const m=roofers.filter(r=>r.territories.includes(st.zip));m.forEach(r=>onUpdate("add_lead",{lead:{id:"l"+Date.now()+Math.random(),homeowner:"Storm Prospect "+st.zip,phone:"000-000-0000",zip:st.zip,rooferId:r.id,stormType:st.type,status:"pending",conversations:[],notes:"",contactedAt:null,followupSent:false}}));onUpdate("process_storm",{stormId:st.id});addActivity({type:"storm",message:`Storm ${st.location} processed — ${m.length} roofer(s) notified`,badge:`${m.length} roofers`,badgeColor:C.orange});alert(`Processed: ${m.length} roofer(s) notified.`);}}>Process</Btn>}</TD>
        </TR>)}
      </TableWrap>
      <StormMap storms={storms} roofers={roofers}/>
    </div>}

    {tab==="Roofers"&&<div>
      <div style={{...flex(0,"center","flex-end"),marginBottom:14}}><Btn variant="primary" onClick={()=>setShowAddRoofer(true)}>+ Add Roofer</Btn></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
        {roofers.map(r=><div key={r.id} onClick={()=>onSelectRoofer(r)} style={{...card(),cursor:"pointer",transition:"all 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.background=C.cardHov;e.currentTarget.style.borderColor=C.borderAct;}} onMouseLeave={e=>{e.currentTarget.style.background=C.card;e.currentTarget.style.borderColor=C.border;}}>
          <div style={{...flex(0,"center","space-between"),marginBottom:6}}>
            <div style={T.head(14,600)}>{r.name}</div>
            <div style={flex(5)}><Badge label={r.plan} color={PLAN_COLORS[r.plan]} small/><StatusBadge status={r.status}/></div>
          </div>
          <div style={{fontSize:12,color:C.textMuted,marginBottom:14}}>{r.owner} · {r.email}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14,padding:"10px 0",borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`}}>
            {[["Leads",r.leads,C.orange],["Booked",r.booked,C.blue],["Rev","$"+(r.revenue/1000).toFixed(0)+"k",C.green],["Pend",leads.filter(l=>l.rooferId===r.id&&l.status==="pending").length,C.textSub]].map(([lbl,val,clr])=><div key={lbl} style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:clr,lineHeight:1.2}}>{val}</div><div style={{...T.label,fontSize:9,marginTop:3}}>{lbl}</div></div>)}
          </div>
          <div style={{marginBottom:10}}>
            <div style={{...T.label,marginBottom:6}}>Territories</div>
            <div style={{...flex(5),flexWrap:"wrap"}}>{r.territories.map(z=><Badge key={z} label={z} color={C.blue} small/>)}</div>
          </div>
          <div style={{...flex(6,"center","flex-end")}} onClick={e=>e.stopPropagation()}>
            <Btn small onClick={()=>setEditingRoofer(r)}>✏ Edit</Btn>
            <Btn small variant="danger" onClick={()=>{if(window.confirm("Delete "+r.name+"? This also deletes their leads."))onUpdate("delete_roofer",{rooferId:r.id});}}>🗑 Delete</Btn>
          </div>
        </div>)}
      </div>
    </div>}

    {tab==="All Leads"&&<div>
      <div style={{...flex(0,"center","space-between"),marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{...flex(6),flexWrap:"wrap"}}>
          <Select value={statusFilter} onChange={setStatusFilter} options={[{value:"all",label:"All Status"},{value:"pending",label:"Pending"},{value:"contacted",label:"Contacted"},{value:"scheduled",label:"Scheduled"},{value:"won",label:"Won"},{value:"cold",label:"Cold"}]} style={{width:150}}/>
          <Select value={rooferFilter} onChange={setRooferFilter} options={[{value:"all",label:"All Roofers"},...roofers.map(r=>({value:r.id,label:r.name}))]} style={{width:170}}/>
        </div>
        <div style={flex(6)}>
          {pending.length>0&&<Btn variant="info" small onClick={async()=>{for(const l of pending)await smsLead(l);}}>SMS All Pending ({pending.length})</Btn>}
          <Btn small onClick={()=>exportToCSV(filteredLeads,roofers,"all-leads.csv")}>⬇ CSV</Btn>
          {apiKeys.twilio?.sid&&<Btn variant="ghost" small onClick={fetchTwilioIncoming} disabled={fetchingTwilio}>{fetchingTwilio?"Fetching...":"⟳ Fetch Replies"}</Btn>}
        </div>
      </div>
      <TableWrap headers={["Homeowner","Phone","ZIP","Roofer","Storm","Status","Actions"]} empty={filteredLeads.length===0?"No leads match this filter.":undefined}>
        {filteredLeads.map(l=><LeadRow key={l.id} lead={l} roofers={roofers} onSMS={smsLead} onBook={bookLead} onEdit={setEditingLead} onDelete={l=>onUpdate("delete_lead",{leadId:l.id})} onViewConvo={setViewingConvo} onLogRevenue={setLoggingRevenue} showRoofer={true}/>)}
      </TableWrap>
    </div>}

    {tab==="Conversations"&&<div>
      <div style={{...flex(0,"center","space-between"),marginBottom:14}}>
        <span style={{fontSize:13,color:C.textSub}}>All lead conversations. Leads with replies are highlighted green.</span>
        {apiKeys.twilio?.sid&&<Btn variant="info" small onClick={fetchTwilioIncoming} disabled={fetchingTwilio}>{fetchingTwilio?"Fetching...":"⟳ Fetch New Replies"}</Btn>}
      </div>
      <TableWrap headers={["Homeowner","Roofer","Status","Messages","Last Message",""]} empty={leads.filter(l=>l.conversations?.length>0).length===0?"No conversations yet.":undefined}>
        {leads.filter(l=>l.conversations?.length>0).map(lead=>{
          const r=roofers.find(x=>x.id===lead.rooferId),last=lead.conversations[lead.conversations.length-1],hasReply=lead.conversations.some(c=>c.role==="lead");
          return <TR key={lead.id} highlight={hasReply}>
            <TD bold sub={hasReply?"● REPLIED":undefined} style={hasReply?{color:C.green}:{}}>{lead.homeowner}</TD>
            <TD dim>{r?.name||"—"}</TD>
            <TD><StatusBadge status={lead.status}/></TD>
            <TD>{lead.conversations.length}</TD>
            <TD dim style={{maxWidth:180}}><div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{last?.msg}</div><div style={{fontSize:10,color:C.textMuted,marginTop:2}}>{last?.ts}</div></TD>
            <TD><Btn small variant="info" onClick={()=>setViewingConvo(lead)}>💬 View</Btn></TD>
          </TR>;
        })}
      </TableWrap>
    </div>}

    {tab==="Activity"&&<div style={card()}>
      <div style={{...flex(0,"center","space-between"),marginBottom:14}}>
        <span style={T.head(14,600)}>📋 Activity Feed</span>
        <Badge label={`${activities.length} events`} color={C.textMuted} small/>
      </div>
      <ActivityFeed activities={activities}/>
    </div>}

    {tab==="AI Agent"&&<AIAgent roofers={roofers} leads={leads} storms={storms} apiKeys={apiKeys} onUpdate={onUpdate} context={ctx}/>}
  </div>;
}

// ─── SUBSCRIPTIONS & BILLING ──────────────────────────────────────────────────
function Subscriptions({roofers,onUpdate}){
  const[tab,setTab]=useState("Clients");
  const[showInvite,setShowInvite]=useState(false);
  const[iName,setIName]=useState(""),[iEmail,setIEmail]=useState("");
  const[pricing,setPricing]=useState({
    Starter:{price:297,features:["Up to 50 leads/mo","1 territory","Email support","Basic analytics"]},
    Pro:{price:497,features:["Up to 200 leads/mo","3 territories","SMS automation","Priority support","Full analytics"]},
    Elite:{price:997,features:["Unlimited leads","10 territories","Full AI automation","Dedicated manager","White-label"]},
  });
  const mrr=roofers.filter(r=>r.status==="active").reduce((s,r)=>s+(pricing[r.plan]?.price||PLAN_PRICES[r.plan]),0);

  return <div>
    {showInvite&&<Modal title="Invite Client" onClose={()=>setShowInvite(false)}>
      <div style={{display:"flex",flexDirection:"column",gap:13}}>
        <Input label="Company Name" value={iName} onChange={setIName} placeholder="Apex Roofing"/>
        <Input label="Email" value={iEmail} onChange={setIEmail} type="email" placeholder="owner@company.com"/>
        <div style={{...flex(8,"center","flex-end"),marginTop:4}}>
          <Btn onClick={()=>setShowInvite(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={()=>{if(!iName||!iEmail)return;onUpdate("add_roofer",{roofer:{id:"r"+Date.now(),name:iName,owner:iName,email:iEmail,phone:"",plan:"Starter",status:"trial",territories:[],revenue:0,leads:0,booked:0,inspectors:[],inspections:[],revenueLog:[],commSettings:{...DEFAULT_COMM},pin:"0000"}});setShowInvite(false);setIEmail("");setIName("");alert(`Invite sent to ${iEmail}`);}}>Send Invite</Btn>
        </div>
      </div>
    </Modal>}
    <Tabs tabs={["Clients","Pricing","Billing"]} active={tab} onChange={setTab}/>

    {tab==="Clients"&&<div>
      <div style={{...flex(0,"center","flex-end"),marginBottom:14}}><Btn variant="primary" onClick={()=>setShowInvite(true)}>+ Invite Client</Btn></div>
      <TableWrap headers={["Company","Owner","Email","Plan","Status","MRR","Action"]}>
        {roofers.map(r=><TR key={r.id}>
          <TD bold>{r.name}</TD>
          <TD>{r.owner}</TD>
          <TD dim>{r.email}</TD>
          <TD><select value={r.plan} onChange={e=>onUpdate("update_roofer_plan",{rooferId:r.id,plan:e.target.value})} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,padding:"3px 8px",color:C.text,fontSize:12}}>{["Starter","Pro","Elite"].map(p=><option key={p}>{p}</option>)}</select></TD>
          <TD><StatusBadge status={r.status}/></TD>
          <TD style={{color:C.green,fontWeight:600}}>{r.status==="active"?`$${(pricing[r.plan]?.price||0).toLocaleString()}/mo`:"—"}</TD>
          <TD>{r.status!=="active"?<Btn small variant="success" onClick={()=>onUpdate("update_roofer_status",{rooferId:r.id,status:"active"})}>Activate</Btn>:<Btn small variant="danger" onClick={()=>onUpdate("update_roofer_status",{rooferId:r.id,status:"cancelled"})}>Cancel</Btn>}</TD>
        </TR>)}
      </TableWrap>
    </div>}

    {tab==="Pricing"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16}}>
      {Object.entries(pricing).map(([plan,data])=><div key={plan} style={{...card({position:"relative"}),border:plan==="Pro"?`1px solid ${C.orange}44`:undefined}}>
        {plan==="Pro"&&<div style={{position:"absolute",top:-11,left:"50%",transform:"translateX(-50%)",background:C.orange,color:"#fff",fontSize:9,fontWeight:700,padding:"2px 10px",borderRadius:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Most Popular</div>}
        <div style={{...T.head(16,700),marginBottom:8}}>{plan}</div>
        <div style={{display:"flex",alignItems:"baseline",gap:3,marginBottom:16}}>
          <span style={{fontSize:13,color:C.textMuted}}>$</span>
          <input type="number" value={data.price} onChange={e=>setPricing(p=>({...p,[plan]:{...p[plan],price:Number(e.target.value)}}))} style={{background:"none",border:"none",color:PLAN_COLORS[plan],fontSize:34,fontWeight:700,width:95,outline:"none"}}/>
          <span style={{fontSize:12,color:C.textMuted}}>/mo</span>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
          {data.features.map(f=><div key={f} style={flex(8)}><span style={{color:PLAN_COLORS[plan],fontSize:12}}>✓</span><span style={{fontSize:13,color:C.textSub}}>{f}</span></div>)}
        </div>
        <div style={{padding:"8px 12px",background:C.orangeDim,borderRadius:6,fontSize:12,color:C.textMuted,border:`1px solid ${C.orange}22`}}>
          {roofers.filter(r=>r.plan===plan&&r.status==="active").length} active → ${(data.price*roofers.filter(r=>r.plan===plan&&r.status==="active").length).toLocaleString()}/mo
        </div>
      </div>)}
    </div>}

    {tab==="Billing"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
        <StatCard label="Total MRR" value={`$${mrr.toLocaleString()}`} color={C.green} sub="Active clients" icon="💰"/>
        <StatCard label="Active Clients" value={roofers.filter(r=>r.status==="active").length} color={C.orange} icon="🏢"/>
        <StatCard label="Annual Run Rate" value={`$${(mrr*12).toLocaleString()}`} color={C.blue} icon="📈"/>
      </div>
      <TableWrap headers={["Company","Plan","Status","Monthly","Next Billing"]}>
        {roofers.map(r=><TR key={r.id}>
          <TD bold>{r.name}</TD>
          <TD><Badge label={r.plan} color={PLAN_COLORS[r.plan]} small/></TD>
          <TD><StatusBadge status={r.status}/></TD>
          <TD style={{color:r.status==="active"?C.green:C.textMuted,fontWeight:r.status==="active"?600:400}}>{r.status==="active"?`$${(pricing[r.plan]?.price||0).toLocaleString()}`:"—"}</TD>
          <TD dim>{r.status==="active"?"Jul 1, 2025":"—"}</TD>
        </TR>)}
      </TableWrap>
    </div>}
  </div>;
}

// ─── API SETTINGS ─────────────────────────────────────────────────────────────
function APISettings({apiKeys,onUpdate}){
  const[keys,setKeys]=useState({weather:apiKeys.weather||"",twilioSid:apiKeys.twilio?.sid||"",twilioToken:apiKeys.twilio?.token||"",twilioPhone:apiKeys.twilio?.from||"",googleCalClientId:apiKeys.googleCal?.clientId||"",googleCalClientSecret:apiKeys.googleCal?.clientSecret||"",googleCalRefreshToken:apiKeys.googleCal?.refreshToken||"",attom:apiKeys.attom||"",stripePublishable:apiKeys.stripe?.publishable||"",stripeSecret:apiKeys.stripe?.secret||""});
  const[testResults,setTestResults]=useState({});

  function save(){onUpdate("api_keys",{weather:keys.weather,twilio:keys.twilioSid?{sid:keys.twilioSid,token:keys.twilioToken,from:keys.twilioPhone}:null,googleCal:keys.googleCalClientId?{clientId:keys.googleCalClientId,clientSecret:keys.googleCalClientSecret,refreshToken:keys.googleCalRefreshToken}:null,attom:keys.attom,stripe:keys.stripeSecret?{publishable:keys.stripePublishable,secret:keys.stripeSecret}:null});alert("API keys saved!");}

  async function testService(name){
    setTestResults(p=>({...p,[name]:"Testing..."}));
    try{
      if(name==="weather"&&keys.weather){const r=await fetch(`https://api.weatherapi.com/v1/current.json?key=${keys.weather}&q=75023`);const d=await r.json();setTestResults(p=>({...p,[name]:d.error?"❌ "+d.error.message:"✓ Connected — "+d.location?.name}));}
      else if(name==="googleCal"&&keys.googleCalClientId){const t=await getGCalAccessToken({clientId:keys.googleCalClientId,clientSecret:keys.googleCalClientSecret,refreshToken:keys.googleCalRefreshToken});setTestResults(p=>({...p,[name]:t?"✓ Token refreshed successfully":"❌ Failed"}));}
      else if(name==="twilio"&&keys.twilioSid){const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${keys.twilioSid}.json`,{headers:{"Authorization":"Basic "+btoa(keys.twilioSid+":"+keys.twilioToken)}});const d=await r.json();setTestResults(p=>({...p,[name]:d.friendly_name?"✓ "+d.friendly_name:"❌ "+(d.message||"Invalid credentials")}));}
      else if(name==="attom"&&keys.attom){const r=await fetch("https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile?postalcode=75023&pagesize=1",{headers:{"apikey":keys.attom,"Accept":"application/json"}});const d=await r.json();setTestResults(p=>({...p,[name]:d.property?"✓ Connected":"❌ "+(d.status?.msg||"Invalid key")}));}
      else if(name==="stripe"&&keys.stripeSecret){const r=await fetch("https://api.stripe.com/v1/balance",{headers:{"Authorization":"Bearer "+keys.stripeSecret}});const d=await r.json();setTestResults(p=>({...p,[name]:d.object==="balance"?"✓ Connected":"❌ "+(d.error?.message||"Invalid key")}));}
      else if(name==="claude"){const r=await callClaude([{role:"user",content:"Reply with exactly: SkyShield connected"}]);setTestResults(p=>({...p,[name]:"✓ "+r.trim().slice(0,40)}));}
      else setTestResults(p=>({...p,[name]:"⚠ Enter key above and try again"}));
    }catch(e){setTestResults(p=>({...p,[name]:"❌ "+e.message}));}
  }

  const services=[
    {id:"weather",name:"WeatherAPI.com",desc:"Storm alert scanning",link:"https://www.weatherapi.com/",fields:[{k:"weather",label:"API Key"}]},
    {id:"twilio",name:"Twilio SMS",desc:"Outbound SMS + incoming reply polling",link:"https://www.twilio.com/",fields:[{k:"twilioSid",label:"Account SID"},{k:"twilioToken",label:"Auth Token",pw:true},{k:"twilioPhone",label:"From Phone Number"}]},
    {id:"googleCal",name:"Google Calendar",desc:"Inspection scheduling sync",link:"https://console.cloud.google.com/",fields:[{k:"googleCalClientId",label:"Client ID"},{k:"googleCalClientSecret",label:"Client Secret",pw:true},{k:"googleCalRefreshToken",label:"Refresh Token",pw:true}]},
    {id:"attom",name:"ATTOM Property Data",desc:"Property data enrichment",link:"https://www.attomdata.com/",fields:[{k:"attom",label:"API Key"}]},
    {id:"stripe",name:"Stripe",desc:"Subscription billing",link:"https://dashboard.stripe.com/",fields:[{k:"stripePublishable",label:"Publishable Key"},{k:"stripeSecret",label:"Restricted Key",pw:true}]},
    {id:"claude",name:"Claude AI (Built-in)",desc:"Powers AI Agent & SMS generation",link:"https://console.anthropic.com/",fields:[]},
  ];
  const configured=id=>{if(id==="twilio")return !!keys.twilioSid;if(id==="googleCal")return !!keys.googleCalClientId&&!!keys.googleCalRefreshToken;if(id==="stripe")return !!keys.stripeSecret;if(id==="claude")return true;return !!keys[id];};

  return <div>
    <div style={{...flex(0,"center","space-between"),marginBottom:20}}>
      <div><div style={T.head(18,700)}>API Configuration</div><div style={{fontSize:13,color:C.textMuted,marginTop:4}}>Connect services to unlock full automation</div></div>
      <Btn variant="primary" onClick={save}>Save All Keys</Btn>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16}}>
      {services.map(svc=><div key={svc.id} style={card()}>
        <div style={{...flex(0,"center","space-between"),marginBottom:svc.fields.length?14:0}}>
          <div><div style={T.head(13,600)}>{svc.name}</div><div style={{fontSize:12,color:C.textMuted,marginTop:3}}>{svc.desc}</div></div>
          <Badge label={configured(svc.id)?"connected":"not set"} color={configured(svc.id)?C.green:C.textMuted} small/>
        </div>
        {svc.fields.length>0&&<div style={{display:"flex",flexDirection:"column",gap:10}}>{svc.fields.map(f=><Input key={f.k} label={f.label} type={f.pw?"password":"text"} value={keys[f.k]} onChange={v=>setKeys(p=>({...p,[f.k]:v}))} placeholder="Enter key..."/>)}</div>}
        {svc.id==="claude"&&<div style={{padding:"8px 12px",background:C.greenDim,borderRadius:6,fontSize:12,color:C.green,border:`1px solid ${C.green}22`}}>✓ Claude AI is pre-configured and ready to use.</div>}
        <div style={{...flex(0,"center","space-between"),marginTop:14}}>
          <a href={svc.link} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.blue}}>Get API Key ↗</a>
          <Btn small onClick={()=>testService(svc.id)}>Test Connection</Btn>
        </div>
        {testResults[svc.id]&&<div style={{marginTop:8,padding:"6px 10px",borderRadius:5,fontSize:12,color:testResults[svc.id].startsWith("✓")?C.green:testResults[svc.id].startsWith("⚠")?C.yellow:C.red,background:testResults[svc.id].startsWith("✓")?C.greenDim:testResults[svc.id].startsWith("⚠")?C.yellowDim:C.redDim}}>{testResults[svc.id]}</div>}
      </div>)}
    </div>
  </div>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  const[roofers,setRoofers]=useState(INIT_ROOFERS);
  const[leads,setLeads]=useState(INIT_LEADS);
  const[storms,setStorms]=useState(INIT_STORMS);
  const[apiKeys,setApiKeys]=useState({});
  const[activeSection,setActiveSection]=useState("Command Center");
  const[selectedRoofer,setSelectedRoofer]=useState(null);
  const[scanSettings,setScanSettings]=useState({interval:"daily",startTime:"07:00",lastScan:null});
  const[activities,setActivities]=useState([{type:"system",message:"SkyShield Pro initialized and ready.",ts:new Date().toLocaleString(),badge:"ready",badgeColor:C.green}]);
  const[auth,setAuth]=useState({loggedIn:false,role:null,roofer:null});

  // Load Leaflet map library
  useEffect(()=>{
    if(window.L) return;
    const link=document.createElement("link");link.rel="stylesheet";link.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(link);
    const script=document.createElement("script");script.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";document.head.appendChild(script);
  },[]);

  function addActivity(entry){setActivities(p=>[{...entry,ts:new Date().toLocaleString()},...p].slice(0,200));}

  function handleUpdate(action,payload){
    switch(action){
      case "add_roofer":setRoofers(p=>[...p,payload.roofer]);break;
      case "add_lead":setLeads(p=>[...p,payload.lead]);setRoofers(p=>p.map(r=>r.id===payload.lead.rooferId?{...r,leads:r.leads+1}:r));addActivity({type:"lead",message:`New lead: ${payload.lead.homeowner} (${payload.lead.zip})`});break;
      case "add_storm":if(!storms.some(s=>s.zip===payload.storm.zip&&s.date===payload.storm.date)){setStorms(p=>[...p,payload.storm]);addActivity({type:"storm",message:`Storm detected: ${payload.storm.type} in ${payload.storm.location}`,badge:payload.storm.severity,badgeColor:{extreme:C.red,severe:C.orange,moderate:C.yellow}[payload.storm.severity]||C.blue});}break;
      case "process_storm":setStorms(p=>p.map(s=>s.id===payload.stormId?{...s,processed:true}:s));break;
      case "lead_status":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,status:payload.status}:l));break;
      case "add_conversation":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,conversations:[...(l.conversations||[]),payload.entry]}:l));break;
      case "update_lead_notes":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,notes:payload.notes}:l));break;
      case "set_contacted_at":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,contactedAt:payload.ts}:l));break;
      case "mark_followup_sent":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,followupSent:true}:l));break;
      case "book_lead":setLeads(p=>p.map(l=>l.id===payload.leadId?{...l,status:"scheduled"}:l));setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,booked:r.booked+1,inspections:[...r.inspections,payload.inspection]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,booked:p.booked+1,inspections:[...p.inspections,payload.inspection]}:p);break;
      case "log_revenue":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,revenue:r.revenue+payload.entry.amount,revenueLog:[...(r.revenueLog||[]),payload.entry]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,revenue:p.revenue+payload.entry.amount,revenueLog:[...(p.revenueLog||[]),payload.entry]}:p);break;
      case "update_inspection_status":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspections:r.inspections.map(i=>i.id===payload.inspectionId?{...i,status:payload.status}:i)}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspections:p.inspections.map(i=>i.id===payload.inspectionId?{...i,status:payload.status}:i)}:p);break;
      case "add_inspector":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspectors:[...r.inspectors,payload.inspector]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspectors:[...p.inspectors,payload.inspector]}:p);break;
      case "add_inspection":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,inspections:[...r.inspections,payload.inspection]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,inspections:[...p.inspections,payload.inspection]}:p);break;
      case "add_territory":setRoofers(p=>p.map(r=>r.id===payload.rooferId&&!r.territories.includes(payload.zip)?{...r,territories:[...r.territories,payload.zip]}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId&&!p.territories.includes(payload.zip)?{...p,territories:[...p.territories,payload.zip]}:p);break;
      case "remove_territory":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,territories:r.territories.filter(z=>z!==payload.zip)}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,territories:p.territories.filter(z=>z!==payload.zip)}:p);break;
      case "update_roofer_plan":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,plan:payload.plan}:r));break;
      case "update_roofer_status":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,status:payload.status}:r));break;
      case "update_comm_settings":setRoofers(p=>p.map(r=>r.id===payload.rooferId?{...r,commSettings:payload.settings}:r));setSelectedRoofer(p=>p&&p.id===payload.rooferId?{...p,commSettings:payload.settings}:p);break;
      case "api_keys":setApiKeys(payload);break;
      case "delete_roofer":setRoofers(p=>p.filter(r=>r.id!==payload.rooferId));setLeads(p=>p.filter(l=>l.rooferId!==payload.rooferId));if(selectedRoofer?.id===payload.rooferId)setSelectedRoofer(null);break;
      case "edit_roofer":setRoofers(p=>p.map(r=>r.id===payload.roofer.id?{...r,...payload.roofer}:r));setSelectedRoofer(p=>p&&p.id===payload.roofer.id?{...p,...payload.roofer}:p);break;
      case "delete_lead":setLeads(p=>p.filter(l=>l.id!==payload.leadId));break;
      case "edit_lead":setLeads(p=>p.map(l=>l.id===payload.lead.id?{...l,...payload.lead}:l));break;
      default:break;
    }
  }

  function selectRoofer(roofer){setSelectedRoofer(roofer);setActiveSection("Roofer Dashboard");}

  // ── NAV CONFIG ────────────────────────────────────────────────────────────
  const navSections=["Command Center","Subscriptions & Billing","API Settings"];
  const navStyle=(active)=>({background:"none",border:"none",cursor:"pointer",padding:"6px 12px",borderRadius:6,fontSize:13,fontWeight:500,color:active?C.orange:C.textSub,background:active?C.orangeDim:"transparent"});

  // ── SHOW LOGIN ─────────────────────────────────────────────────────────────
  if(!auth.loggedIn) return <><FontLoader/><LoginScreen roofers={roofers} onAdminLogin={()=>setAuth({loggedIn:true,role:"admin",roofer:null})} onRooferLogin={r=>{setAuth({loggedIn:true,role:"roofer",roofer:r});selectRoofer(r);}}/></>;

  // ── ROOFER VIEW ────────────────────────────────────────────────────────────
  if(auth.role==="roofer"){
    const live=roofers.find(r=>r.id===auth.roofer.id)||auth.roofer;
    return <div style={{minHeight:"100vh",background:C.bg}}><FontLoader/>
      <nav style={{position:"sticky",top:0,zIndex:100,background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 20px"}}>
        <div style={{maxWidth:1300,margin:"0 auto",...flex(0,"center","space-between"),height:54}}>
          <div style={flex(10)}>
            <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${C.orange},#c0392b)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>⛈</div>
            <div><div style={T.head(14,700)}>Sky<span style={{color:C.orange}}>Shield</span> Pro</div><div style={{fontSize:9,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Ark Dynamics</div></div>
          </div>
          <div style={flex(10)}><span style={{fontSize:13,color:C.textSub,fontWeight:500}}>{live.name}</span><Badge label={live.plan} color={PLAN_COLORS[live.plan]} small/><Btn small variant="ghost" onClick={()=>setAuth({loggedIn:false,role:null,roofer:null})}>Sign Out</Btn></div>
        </div>
      </nav>
      <main style={{maxWidth:1300,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{marginBottom:20}}><div style={T.head(22,700)}>{live.name}</div><div style={{...flex(8),marginTop:8}}><Badge label={live.plan} color={PLAN_COLORS[live.plan]}/><StatusBadge status={live.status}/></div></div>
        <RooferDashboard roofer={live} leads={leads} apiKeys={apiKeys} onUpdate={handleUpdate} addActivity={addActivity}/>
      </main>
    </div>;
  }

  // ── ADMIN VIEW ─────────────────────────────────────────────────────────────
  return <div style={{minHeight:"100vh",background:C.bg}}><FontLoader/>
    <nav style={{position:"sticky",top:0,zIndex:100,background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 20px"}}>
      <div style={{maxWidth:1300,margin:"0 auto",...flex(0,"center","space-between"),height:54}}>

        {/* Logo */}
        <div style={flex(10)}>
          <div style={{width:32,height:32,borderRadius:8,background:`linear-gradient(135deg,${C.orange},#c0392b)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>⛈</div>
          <div>
            <div style={T.head(15,700)}>Sky<span style={{color:C.orange}}>Shield</span> Pro</div>
            <div style={{fontSize:9,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginTop:1}}>Powered by Ark Dynamics</div>
          </div>
        </div>

        {/* Nav links */}
        <div style={flex(2)}>
          {navSections.map(sec=><button key={sec} onClick={()=>{setActiveSection(sec);setSelectedRoofer(null);}} style={navStyle(activeSection===sec&&!selectedRoofer)}>{sec}</button>)}
          {selectedRoofer&&<div style={flex(6)}>
            <span style={{color:C.textMuted,fontSize:12}}>›</span>
            <button onClick={()=>setSelectedRoofer(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.textSub,fontSize:13}}>Command Center</button>
            <span style={{color:C.textMuted,fontSize:12}}>›</span>
            <span style={{fontSize:13,color:C.orange,fontWeight:600}}>{selectedRoofer.name}</span>
          </div>}
        </div>

        {/* Status + sign out */}
        <div style={flex(12)}>
          <div style={{...flex(5),fontSize:12,color:C.textMuted}}><span style={{color:C.green,fontSize:8}}>●</span>{roofers.filter(r=>r.status==="active").length} active</div>
          <div style={{...flex(5),fontSize:12,color:C.textMuted}}><span style={{color:C.orange,fontSize:8}}>●</span>{leads.filter(l=>l.status==="pending").length} pending</div>
          {scanSettings.interval!=="manual"&&<div style={{...flex(5),fontSize:12,color:C.textMuted}}><span style={{color:C.blue,fontSize:8}}>●</span>auto-scan</div>}
          <Btn small variant="ghost" onClick={()=>setAuth({loggedIn:false,role:null,roofer:null})}>Sign Out</Btn>
        </div>
      </div>
    </nav>

    <main style={{maxWidth:1300,margin:"0 auto",padding:"24px 20px"}}>
      <div style={{marginBottom:22}}>
        <div style={T.head(22,700)}>{selectedRoofer?selectedRoofer.name:activeSection}</div>
        {selectedRoofer&&<div style={{...flex(8),marginTop:8}}>
          <Badge label={selectedRoofer.plan} color={PLAN_COLORS[selectedRoofer.plan]}/>
          <StatusBadge status={selectedRoofer.status}/>
          <span style={{fontSize:12,color:C.textMuted}}>{selectedRoofer.owner} · {selectedRoofer.email}</span>
        </div>}
      </div>

      {selectedRoofer
        ?<RooferDashboard roofer={roofers.find(r=>r.id===selectedRoofer.id)||selectedRoofer} leads={leads} apiKeys={apiKeys} onUpdate={handleUpdate} addActivity={addActivity}/>
        :activeSection==="Command Center"
          ?<CommandCenter roofers={roofers} leads={leads} storms={storms} apiKeys={apiKeys} onUpdate={handleUpdate} onSelectRoofer={selectRoofer} scanSettings={scanSettings} onScanSettingsChange={setScanSettings} activities={activities} addActivity={addActivity}/>
          :activeSection==="Subscriptions & Billing"
            ?<Subscriptions roofers={roofers} onUpdate={handleUpdate}/>
            :<APISettings apiKeys={apiKeys} onUpdate={handleUpdate}/>
      }
    </main>
  </div>;
}
