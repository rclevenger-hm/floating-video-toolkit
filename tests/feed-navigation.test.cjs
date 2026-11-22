const test = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const {createNavigator, viewFor} = require('../feed-navigation.js');

function fixture(url, html) {
  const dom = new JSDOM(html, {url, pretendToBeVisual:true});
  const doc = dom.window.document;
  for (const element of doc.querySelectorAll('*')) element.getBoundingClientRect = () => ({width:40,height:40,top:0,left:0,bottom:40,right:40});
  const clicks = [];
  doc.addEventListener('click', event => {event.preventDefault(); clicks.push(event.target.closest('button, [role="button"], a')?.id);});
  const video = doc.querySelector('video'), container = video?.parentElement;
  const nav = createNavigator({document:doc,getVideo:()=>video,getSourceContainer:()=>container});
  return {dom,doc,video,nav,clicks,close:()=>dom.window.close()};
}

test('matches exact service hosts, subdomains and relevant views only', () => {
  for (const url of ['https://youtube.com.evil.test/shorts/a','https://evilyoutube.com/watch','https://instagram.com/p/a','https://facebook.com/','https://tiktok.com/@profile','https://youtube.com/','file:///watch']) assert.equal(viewFor(new URL(url)),null,url);
  assert.equal(viewFor(new URL('https://m.youtube.com/watch?v=a')),'youtube');
  assert.equal(viewFor(new URL('https://www.instagram.com/reels/a/')),'instagram');
});

test('YouTube watch uses player controls, never unrelated page buttons or history', () => {
  const f = fixture('https://www.youtube.com/watch?v=a','<button aria-label="Next video" id="unrelated"></button><div id="movie_player"><video></video><a class="ytp-next-button" id="next"></a><a class="ytp-prev-button" id="previous"></a></div>');
  assert.equal(f.nav.navigate('next'),true); assert.equal(f.nav.navigate('previous'),true);
  assert.deepEqual(f.clicks,['next','previous']); assert.equal(f.nav.navigate('back'),false); f.close();
});

test('Shorts navigation finds existing arrow controls', () => {
  const f = fixture('https://www.youtube.com/shorts/a','<ytd-shorts><video></video><div id="navigation-button-down"><button id="next"></button></div><div id="navigation-button-up"><button id="previous"></button></div></ytd-shorts>');
  assert.equal(f.nav.navigate('next'),true); assert.equal(f.nav.navigate('previous'),true);
  assert.deepEqual(f.clicks,['next','previous']); f.close();
});

for (const [name,url,controls] of [
  ['Instagram','https://www.instagram.com/reels/a/','<div role="button" id="next"><svg aria-label="Next"></svg></div><div role="button" id="previous"><svg aria-label="Previous"></svg></div>'],
  ['Facebook','https://www.facebook.com/reel/123','<div role="button" aria-label="Next reel" id="next"></div><div role="button" aria-label="Previous reel" id="previous"></div>'],
  ['TikTok','https://www.tiktok.com/foryou','<button data-e2e="arrow-down" id="next"></button><button data-e2e="arrow-up" id="previous"></button>']
]) test(`${name} routes next/previous within the video feed`, () => {
  const f = fixture(url,`<button aria-label="Next" id="outside"></button><main><video></video>${controls}</main>`);
  assert.equal(f.nav.navigate('next'),true); assert.equal(f.nav.navigate('previous'),true);
  assert.deepEqual(f.clicks,['next','previous']); f.close();
});

test('retained source container supports a video moved to Document PiP', () => {
  const f = fixture('https://instagram.com/reel/a/','<main><section><video></video></section><button aria-label="Next" id="next"></button></main>');
  const pip = new JSDOM('<body></body>'); pip.window.document.body.appendChild(f.video);
  assert.equal(f.nav.navigate('next'),true); assert.deepEqual(f.clicks,['next']); pip.window.close(); f.close();
});

for (const attribute of ['disabled','aria-disabled="true"','hidden','style="display:none"','style="visibility:hidden"','style="opacity:0"','style="pointer-events:none"']) test(`rejects unavailable controls: ${attribute}`, () => {
  const f = fixture('https://tiktok.com/foryou',`<main><video></video><button data-e2e="arrow-down" ${attribute}></button></main>`);
  assert.equal(f.nav.navigate('next'),false); assert.deepEqual(f.clicks,[]); f.close();
});

test('ignores hidden ancestor, offscreen and ambiguous buttons', () => {
  const f = fixture('https://facebook.com/reel/a','<main><video></video><div hidden><button aria-label="Next reel"></button></div><button id="offscreen" aria-label="Next reel"></button></main>');
  f.doc.querySelector('#offscreen').getBoundingClientRect=()=>({width:40,height:40,top:2000,left:0,bottom:2040,right:40});
  assert.equal(f.nav.navigate('next'),false);
  f.doc.querySelector('#offscreen').getBoundingClientRect=()=>({width:40,height:40,top:0,left:0,bottom:40,right:40});
  const second=f.doc.querySelector('#offscreen').cloneNode(); second.getBoundingClientRect=f.doc.querySelector('#offscreen').getBoundingClientRect; f.doc.querySelector('main').appendChild(second);
  assert.equal(f.nav.navigate('next'),false); assert.deepEqual(f.clicks,[]); f.close();
});

test('missing controls fail without synthetic key events or URL changes', () => {
  const f = fixture('https://instagram.com/reels/a/','<main><video></video></main>');
  let keys=0; f.doc.addEventListener('keydown',()=>keys++);
  assert.equal(f.nav.navigate('next'),false); assert.equal(f.nav.navigate('previous'),false);
  assert.equal(keys,0); assert.equal(f.doc.location.href,'https://instagram.com/reels/a/'); f.close();
});

test('dialog scope excludes the background feed and non-button labels', () => {
  const f = fixture('https://tiktok.com/@author/video/123','<main><button data-e2e="arrow-right" id="background"></button><div role="dialog"><video></video><span aria-label="Next video"></span><button aria-label="Next video" id="next"></button></div></main>');
  assert.equal(f.nav.navigate('next'),true); assert.deepEqual(f.clicks,['next']); f.close();
});
test('YouTube auto-hidden control chrome does not disable exact playlist buttons', () => {
 const f=fixture('https://youtube.com/watch?v=a','<div id="movie_player"><video></video><div class="ytp-chrome-bottom" style="opacity:0"><a class="ytp-next-button" id="next"></a></div></div>');
 assert.equal(f.nav.navigate('next'),true);assert.deepEqual(f.clicks,['next']);f.close();
});
