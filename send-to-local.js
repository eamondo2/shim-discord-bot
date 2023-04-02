// ==UserScript==
// @name         Send To MPV
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://www.youtube.com/feed/subscriptions
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant       GM_xmlhttpRequest
// @run-at       context-menu
// ==/UserScript==

function getLastTarget(e) {
    let lastVal = GM_getValue("lastClickTarget", null);
    if (!lastVal) return;
    console.log("lastVal", lastVal);
    GM_xmlhttpRequest({
            method: "POST",
            url: "http://localhost:30001/newVideo",
            data: JSON.stringify({target: lastVal}),
            headers: {
                "Content-Type": "application/json"
            }
        });
}

function scrapeUrlFromImg(srcLabels) {

    let resId = "";
    let tgt_url = "";
    for (let elem of srcLabels) {
      let tgt_field;
      if (elem.src) {
          tgt_field = elem.src;
      } else if (elem.href) {
          tgt_field = elem.href;
      }

      const regex = /[\/]([a-zA-Z0-9\-\_]{11})[\/]/gm;
      let video_id_matches = regex.exec(tgt_field);

      if (video_id_matches && video_id_matches.length >= 1) {
          if (video_id_matches[1] && video_id_matches[1].length > 2){
             if (resId === ""){
                 resId = video_id_matches[1];
                 console.log(tgt_field);
             }
             break;
          }
      }
    }
    console.log("resId", resId);
    return resId;

}

(function() {
    'use strict';
    GM_registerMenuCommand("Send to MPV shim", getLastTarget, "s");
    document.addEventListener("pointerdown", (event) => {
       if (event.button !== 2) {
           return;
       }
       console.log(event);
       let elemsFromPoint = document.elementsFromPoint(event.clientX, event.clientY);
       let resId = scrapeUrlFromImg(elemsFromPoint);
       GM_setValue("lastClickTarget", resId);


    });

    // Your code here...
})();