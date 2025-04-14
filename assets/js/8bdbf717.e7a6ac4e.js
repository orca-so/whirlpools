"use strict";(self.webpackChunk_orca_so_whirlpools_docs=self.webpackChunk_orca_so_whirlpools_docs||[]).push([[346],{1184:(e,o,t)=>{t.d(o,{R:()=>c,x:()=>s});var n=t(4041);const r={},i=n.createContext(r);function c(e){const o=n.useContext(i);return n.useMemo((function(){return"function"==typeof e?e(o):{...o,...e}}),[o,e])}function s(e){let o;return o=e.disableParentContext?"function"==typeof e.components?e.components(r):e.components||r:c(e.components),n.createElement(i.Provider,{value:o},e.children)}},1801:(e,o,t)=>{t.d(o,{A:()=>y});var n=t(4041),r=t(4357),i=t(6279),c=t(7749),s=t(1215);const l=["zero","one","two","few","many","other"];function a(e){return l.filter((o=>e.includes(o)))}const u={locale:"en",pluralForms:a(["one","other"]),select:e=>1===e?"one":"other"};function p(){const{i18n:{currentLocale:e}}=(0,s.A)();return(0,n.useMemo)((()=>{try{return function(e){const o=new Intl.PluralRules(e);return{locale:e,pluralForms:a(o.resolvedOptions().pluralCategories),select:e=>o.select(e)}}(e)}catch(o){return console.error(`Failed to use Intl.PluralRules for locale "${e}".\nDocusaurus will fallback to the default (English) implementation.\nError: ${o.message}\n`),u}}),[e])}function h(){const e=p();return{selectMessage:(o,t)=>function(e,o,t){const n=e.split("|");if(1===n.length)return n[0];n.length>t.pluralForms.length&&console.error(`For locale=${t.locale}, a maximum of ${t.pluralForms.length} plural forms are expected (${t.pluralForms.join(",")}), but the message contains ${n.length}: ${e}`);const r=t.select(o),i=t.pluralForms.indexOf(r);return n[Math.min(i,n.length-1)]}(t,o,e)}}var d=t(5797),m=t(5141),f=t(4661);const g={cardContainer:"cardContainer_S8oU",cardTitle:"cardTitle_HoSo",cardDescription:"cardDescription_c27F"};var w=t(1085);function j(e){let{href:o,children:t}=e;return(0,w.jsx)(i.A,{href:o,className:(0,r.A)("card padding--lg",g.cardContainer),children:t})}function x(e){let{href:o,icon:t,title:n,description:i}=e;return(0,w.jsxs)(j,{href:o,children:[(0,w.jsxs)(f.A,{as:"h2",className:(0,r.A)("text--truncate",g.cardTitle),title:n,children:[t," ",n]}),i&&(0,w.jsx)("p",{className:(0,r.A)("text--truncate",g.cardDescription),title:i,children:i})]})}function k(e){let{item:o}=e;const t=(0,c.Nr)(o),n=function(){const{selectMessage:e}=h();return o=>e(o,(0,m.T)({message:"1 item|{count} items",id:"theme.docs.DocCard.categoryDescription.plurals",description:"The default description for a category card in the generated index about how many items this category includes"},{count:o}))}();return t?(0,w.jsx)(x,{href:t,icon:"\ud83d\uddc3\ufe0f",title:o.label,description:o.description??n(o.items.length)}):null}function b(e){let{item:o}=e;const t=(0,d.A)(o.href)?"\ud83d\udcc4\ufe0f":"\ud83d\udd17",n=(0,c.cC)(o.docId??void 0);return(0,w.jsx)(x,{href:o.href,icon:t,title:o.label,description:o.description??n?.description})}function y(e){let{item:o}=e;switch(o.type){case"link":return(0,w.jsx)(b,{item:o});case"category":return(0,w.jsx)(k,{item:o});default:throw new Error(`unknown item type ${JSON.stringify(o)}`)}}},7638:(e,o,t)=>{t.r(o),t.d(o,{assets:()=>a,contentTitle:()=>l,default:()=>h,frontMatter:()=>s,metadata:()=>n,toc:()=>u});const n=JSON.parse('{"id":"More Resources/Account Microscope","title":"Account microscope","description":"When developing with Whirlpool, it is often necessary to check the state of accounts and to obtain a list of whirlpools and positions.  And sometimes we want to do hexdump and download accounts to clone Whirlpool.","source":"@site/docs/05-More Resources/04-Account Microscope.mdx","sourceDirName":"05-More Resources","slug":"/More Resources/Account Microscope","permalink":"/More Resources/Account Microscope","draft":false,"unlisted":false,"editUrl":"https://github.com/orca-so/whirlpools/tree/main/docs/whirlpool/docs/05-More Resources/04-Account Microscope.mdx","tags":[],"version":"current","sidebarPosition":4,"frontMatter":{},"sidebar":"sidebar","previous":{"title":"IDL","permalink":"/More Resources/IDL"},"next":{"title":"PubkeySollet","permalink":"/More Resources/PubkeySollet"}}');var r=t(1085),i=t(1184),c=t(1801);const s={},l="Account microscope",a={},u=[];function p(e){const o={h1:"h1",header:"header",p:"p",...(0,i.R)(),...e.components};return(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)(o.header,{children:(0,r.jsx)(o.h1,{id:"account-microscope",children:"Account microscope"})}),"\n",(0,r.jsx)(o.p,{children:"When developing with Whirlpool, it is often necessary to check the state of accounts and to obtain a list of whirlpools and positions.  And sometimes we want to do hexdump and download accounts to clone Whirlpool."}),"\n",(0,r.jsx)(o.p,{children:"\ud83d\udd2c Account microscope have been designed to do those tasks.  Please enjoy with it!"}),"\n",(0,r.jsx)(c.A,{item:{type:"link",href:"https://everlastingsong.github.io/account-microscope/#/whirlpool/list",label:"Entrance: The list of the Orca supported whirlpools",description:"https://everlastingsong.github.io/account-microscope/#/whirlpool/list"}}),"\n",(0,r.jsx)(c.A,{item:{type:"link",href:"https://everlastingsong.github.io/account-microscope/#/whirlpool/whirlpool/HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ",label:"SOL/USDC(tickSpacing=64) Whirlpool account details",description:"https://everlastingsong.github.io/account-microscope/#/whirlpool/whirlpool/HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ"}}),"\n",(0,r.jsx)(c.A,{item:{type:"link",href:"https://everlastingsong.github.io/account-microscope/#/whirlpool/listPositions/HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ",label:"All positions in SOL/USDC(tickSpacing=64) Whirlpool",description:"https://everlastingsong.github.io/account-microscope/#/whirlpool/listPositions/HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ"}}),"\n",(0,r.jsx)(c.A,{item:{type:"link",href:"https://everlastingsong.github.io/account-microscope/#/generic/HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ",label:"Hexdump of SOL/USDC(tickSpacing=64) Whirlpool",description:"https://everlastingsong.github.io/account-microscope/#/generic/HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ"}})]})}function h(e={}){const{wrapper:o}={...(0,i.R)(),...e.components};return o?(0,r.jsx)(o,{...e,children:(0,r.jsx)(p,{...e})}):p(e)}}}]);