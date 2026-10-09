/**
 * Shining Services Universal Image Slot Manager
 * Features:
 * 1. Copy image URL / Data
 * 2. Server-authorized image editing
 * 3. Open in Google Drive (raw asset folder / deep link)
 * 4. Inline Commenting with Agent-readable persistence (localStorage['shining_slot_comments'])
 * 5. Drag & Drop replacement directly from desktop
 * 6. Interactive Empty Ready Slots
 * 7. Helpful tools: Lightbox zoom, image download, reset to original
 */

(function () {
  'use strict';

  // Authentication is verified server-side; the password is never included in public JavaScript.
  const DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1vFhFkSoAHsn-1uFT1sC1Is7dwzNQXh8Z';
  const COMMENTS_STORAGE_KEY = 'shining_slot_comments';
  const CUSTOM_IMAGES_STORAGE_KEY = 'shining_custom_slot_images';

  const pagePath = decodeURIComponent(document.querySelector('meta[name="ss-editor-path"]')?.content || window.location.pathname.replace(/^\//, '')) || 'index.html';

  const PAGE_KEY = pagePath.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 130);
  const EDITOR_ENDPOINT = '/api/ss-editor';
  let editorAuthorized = false;
  let remoteRecords = {};
  const safeSlot = key => String(key).split('::').pop().toLowerCase().replace(/^slider-/,'ba-').replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '').slice(0, 135);
  async function editorApi(action, slotKey, data) {
    const url = new URL(EDITOR_ENDPOINT, location.origin);
    url.searchParams.set('action', action);
    url.searchParams.set('page', PAGE_KEY);
    if (slotKey) url.searchParams.set('slot', safeSlot(slotKey));
    const options = { credentials: 'same-origin', cache: 'no-store' };
    if (data !== undefined) { options.method = 'POST'; options.headers = {'Content-Type':'application/json'}; options.body = JSON.stringify(data); }
    const response = await fetch(url, options);
    const result = await response.json().catch(()=>({ error:'Editor server response unavailable' }));
    if (!response.ok) {if(response.status===401)editorAuthorized=false;throw Error(result.error || ('Editor request failed: ' + response.status));}
    return result;
  }
  async function unlockEditor(password) {
    if (editorAuthorized) return true;
    await editorApi('login', null, {password});
    editorAuthorized = true;
    const state=await editorApi('state');remoteRecords=state.slots||{};
    showSlotToast('Editing unlocked. Further changes do not require another password.');
    return true;
  }
  async function promptForEditorPassword() {
    if (editorAuthorized) return true;
    ensureModal();document.getElementById('slotModalTitle').textContent='Apply changes: password required';document.getElementById('slotModalBody').innerHTML='<label for="editorPassword">Editor password</label><input id="editorPassword" type="password" autocomplete="current-password"><p id="editorAuthError" role="status"></p>';document.getElementById('slotModalFooter').innerHTML='<button type="button" class="slot-modal-btn cancel" id="editorAuthCancel">Cancel</button><button type="button" class="slot-modal-btn submit" id="editorAuthApply">Unlock editing</button>';modalBackdrop.classList.add('open');
    return await new Promise(resolve=>{document.getElementById('editorAuthCancel').onclick=()=>{closeModal();resolve(false)};document.getElementById('editorAuthApply').onclick=async()=>{try{await unlockEditor(document.getElementById('editorPassword').value);closeModal();resolve(true)}catch(e){document.getElementById('editorAuthError').textContent=e.message}};document.getElementById('editorPassword').focus()});
  }
  const activeWrites=new Map();
  function writeCloudImage(slotKey,url){const key=safeSlot(slotKey)+'::'+url;if(activeWrites.has(key))return activeWrites.get(key);const work=writeCloudImageOnce(slotKey,url).finally(()=>activeWrites.delete(key));activeWrites.set(key,work);return work;}
  async function writeCloudImageOnce(slotKey, url) {
    try {
      if (!editorAuthorized || typeof url !== 'string') return;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      const loaded = new Promise((resolve,reject)=>{
        image.onload = resolve; image.onerror=()=>reject(Error('Image cannot be loaded for server upload'));
      });
      image.src = url;
      await loaded;
      const canvas=document.createElement('canvas');
      const ratio=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      let quality=0.88,webp;
      do {webp=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));quality-=0.1}while(webp&&webp.size>3000000&&quality>0.35);
      if (!webp || webp.size>3100000) throw Error('Image too large to store');
      const base64=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result).split(',')[1]);
        reader.onerror=reject;reader.readAsDataURL(webp);
      });
      const result=await editorApi('upload',slotKey,{image:base64,filename:safeSlot(slotKey)+'.webp'});
      remoteRecords[safeSlot(slotKey)] = {...(remoteRecords[safeSlot(slotKey)]||{}),url:result.url};
      showSlotToast('Image saved online and visible to other reviewers.');
    } catch(error){console.warn('[SlotManager] Cloud upload failed',error);showSlotToast('Image saved only in this browser: '+error.message,true);}
  }
  async function loadCloudState(){
    try{
      const data=await editorApi('state');remoteRecords=data.slots||{};
      const auth=await editorApi('auth');editorAuthorized=!!auth.authenticated;
    }catch(err){console.warn('[SlotManager] Editor server unavailable',err);}
  }


  // If rendered inside the master directory viewer iframe, hide duplicate portal header
  if (window.self !== window.top) {
    const hideDuplicateNav = () => {
      const subNav = document.querySelector('header');
      if (subNav && subNav.textContent.includes('SYDNEY PORTAL')) {
        subNav.style.display = 'none';
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hideDuplicateNav);
    } else {
      hideDuplicateNav();
    }
  }

  // Expose global read function so the AI agent can easily audit all comments anytime
  function getLegacyComments() {
    try {
      return JSON.parse(localStorage.getItem(COMMENTS_STORAGE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  };

  window.__getShiningComments = function () {
    const all = getLegacyComments();
    for (const [slot,record] of Object.entries(remoteRecords)) {
      if (!record.comments?.length) continue;
      const key=pagePath+'::'+slot.toUpperCase();
      all[key]=[...(all[key]||[]),...record.comments.map(c=>({text:c.text,timestamp:c.date,page:pagePath,source:'shared'}))];
    }
    return all;
  };

  window.__exportShiningComments = function () {
    const data = window.__getShiningComments();
    console.log('[Shining Services] Current Slot Comments:', data);
    return JSON.stringify(data, null, 2);
  };

  // Toast notification helper
  function showSlotToast(msg, isError) {
    let toast = document.getElementById('slot-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'slot-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.borderColor = isError ? '#ef4444' : '#38bdf8';
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  // Retrieve comments
  function getCommentsForSlot(slotKey) {
    const all = getLegacyComments();
    return [...(all[slotKey] || []), ...(remoteRecords[safeSlot(slotKey)]?.comments||[]).map(c=>({text:c.text,timestamp:c.date,page:pagePath}))];
  }

  async function addCommentForSlot(slotKey, text) {
    await editorApi('comment',slotKey,{text:text.trim()});
    const record=remoteRecords[safeSlot(slotKey)]||(remoteRecords[safeSlot(slotKey)]={});
    (record.comments||(record.comments=[])).push({text:text.trim(),date:new Date().toISOString()});
  }

  // Retrieve / Save custom slot image override
  function getCustomImage(slotKey) {
    try {
      const all = JSON.parse(localStorage.getItem(CUSTOM_IMAGES_STORAGE_KEY) || '{}');
      return remoteRecords[safeSlot(slotKey)]?.url || remoteRecords[safeSlot(slotKey).replace(/^ba-/,'slider-')]?.url || all[slotKey] || null;
    } catch (e) {
      return null;
    }
  }

  // Compress large dataURI images before storing to prevent QuotaExceededError
  function saveCustomImage(slotKey, dataUrl) {
    if (!dataUrl) return;
    void writeCloudImage(slotKey, dataUrl);
    // If it's a huge base64 dataURI (> 1.2MB), downscale it on a background canvas
    if (dataUrl.startsWith('data:image/') && dataUrl.length > 800000) {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const compressedUrl = canvas.toDataURL('image/jpeg', 0.82);
        try {
          const all = JSON.parse(localStorage.getItem(CUSTOM_IMAGES_STORAGE_KEY) || '{}');
          all[slotKey] = compressedUrl;
          localStorage.setItem(CUSTOM_IMAGES_STORAGE_KEY, JSON.stringify(all));
        } catch (err) {
          console.warn('[SlotManager] Quota exceeded storing compressed image:', err);
        }
      };
      img.src = dataUrl;
      return;
    }

    try {
      const all = JSON.parse(localStorage.getItem(CUSTOM_IMAGES_STORAGE_KEY) || '{}');
      all[slotKey] = dataUrl;
      localStorage.setItem(CUSTOM_IMAGES_STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
      console.warn('[SlotManager] Failed to persist image to localStorage (quota limit):', e);
    }
  }

  function removeCustomImage(slotKey) {
    try {
      const all = JSON.parse(localStorage.getItem(CUSTOM_IMAGES_STORAGE_KEY) || '{}');
      delete all[slotKey];
      localStorage.setItem(CUSTOM_IMAGES_STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  // Modals Container setup
  let modalBackdrop = null;
  function ensureModal() {
    if (modalBackdrop) return modalBackdrop;
    modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'slot-modal-backdrop';
    modalBackdrop.innerHTML = `
      <div class="slot-modal">
        <div class="slot-modal-header">
          <div class="slot-modal-title" id="slotModalTitle">Slot Action</div>
          <button class="slot-modal-close" id="slotModalClose" type="button">&times;</button>
        </div>
        <div class="slot-modal-body" id="slotModalBody"></div>
        <div class="slot-modal-footer" id="slotModalFooter"></div>
      </div>
    `;
    document.body.appendChild(modalBackdrop);

    modalBackdrop.querySelector('#slotModalClose').addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
    return modalBackdrop;
  }

  function closeModal() {
    if (modalBackdrop) {
      modalBackdrop.classList.remove('open');
      document.getElementById('slotModalBody').innerHTML = '';
      document.getElementById('slotModalFooter').innerHTML = '';
    }
  }

  // Lightbox setup
  let lightboxBackdrop = null;
  function openLightbox(imgSrc, altText) {
    if (!lightboxBackdrop) {
      lightboxBackdrop = document.createElement('div');
      lightboxBackdrop.className = 'slot-lightbox-backdrop';
      lightboxBackdrop.innerHTML = `
        <img class="slot-lightbox-img" src="" alt="">
      `;
      document.body.appendChild(lightboxBackdrop);
      lightboxBackdrop.addEventListener('click', () => {
        lightboxBackdrop.classList.remove('open');
      });
    }
    const img = lightboxBackdrop.querySelector('.slot-lightbox-img');
    img.src = imgSrc;
    img.alt = altText || 'Preview';
    lightboxBackdrop.classList.add('open');
  }

  // Staged / Pending Paste Queue for Batch Processing
  const pendingQueue = [];
  let batchBarEl = null;

  function ensureBatchBar() {
    if (batchBarEl) return batchBarEl;
    batchBarEl = document.createElement('div');
    batchBarEl.id = 'slot-batch-bar';
    batchBarEl.innerHTML = `
      <span class="sbb-badge" id="sbbCount">1 PENDING</span>
      <span class="sbb-text">Enter password to apply images:</span>
      <input type="password" id="sbbPass" class="sbb-input" placeholder="Password..." autocomplete="current-password">
      <button type="button" class="sbb-btn-apply" id="sbbApply">Apply changes</button>
      <button type="button" class="sbb-btn-cancel" id="sbbCancel">Cancel</button>
    `;
    document.body.appendChild(batchBarEl);

    const sbbPass = document.getElementById('sbbPass');
    const sbbApply = document.getElementById('sbbApply');
    const sbbCancel = document.getElementById('sbbCancel');

    sbbApply.addEventListener('click', async () => {
      const applyBtn=sbbApply;
      if(!editorAuthorized){
        const password=sbbPass.value;
        if(!password){showSlotToast('Enter password to apply changes.', true);sbbPass.focus();return;}
        applyBtn.disabled=true;
        try{await unlockEditor(password)}
        catch(e){showSlotToast('Incorrect password! Try again.',true);sbbPass.focus();sbbPass.select();applyBtn.disabled=false;return;}
        applyBtn.disabled=false;
      }
      const count = pendingQueue.length;
      while(pendingQueue.length){
        const item=pendingQueue.shift();
        try{item.applyFn(item.dataUrl)}catch(err){console.warn('[SlotManager] Apply failed',err)}
      }
      batchBarEl.classList.remove('show');
      sbbPass.value='';
      showSlotToast('Applied '+count+' image change(s). Further edits are unlocked for this session.');
    });

        sbbCancel.addEventListener('click', () => {
      pendingQueue.length = 0;
      batchBarEl.classList.remove('show');
      sbbPass.value = '';
      showSlotToast('Cancelled pending image paste queue.');
    });

    sbbPass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sbbApply.click();
      }
    });

    return batchBarEl;
  }

  function queueImageForBatch(slotKey, dataUrl, applyFn) {
    if(editorAuthorized){
      try{applyFn(dataUrl);showSlotToast('Image pasted directly. Changes authorized for this session.');}
      catch(e){showSlotToast('Paste failed: '+e.message,true);}
      return;
    }

    pendingQueue.push({ slotKey, dataUrl, applyFn });
    const bar = ensureBatchBar();
    const countBadge = document.getElementById('sbbCount');
    if (countBadge) {
      countBadge.textContent = `${pendingQueue.length} PENDING`;
    }
    bar.classList.add('show');
    const sbbPass = document.getElementById('sbbPass');
    if (sbbPass && document.activeElement !== sbbPass) {
      sbbPass.focus();
    }
    showSlotToast(`${pendingQueue.length} change(s) staged. Apply password to apply changes once.`);
  }

  // Direct Paste from Clipboard into Batch Queue
  async function openPasteModal(slotKey, onApplyImage) {
    try {
      // First attempt: read image binary blob directly from navigator.clipboard
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onload = (e) => {
              const dataUrl = e.target.result;
              queueImageForBatch(slotKey, dataUrl, onApplyImage);
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }

      // Second attempt: read text/URL from clipboard
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:image/'))) {
          queueImageForBatch(slotKey, text.trim(), onApplyImage);
          return;
        }
      }
    } catch (err) {
      console.warn('[SlotManager] Direct clipboard read failed or permission denied:', err);
    }

    // Fallback if clipboard API is blocked by browser permissions
    ensureModal();document.getElementById('slotModalTitle').textContent='Paste image into '+slotKey.split('::').pop();document.getElementById('slotModalBody').innerHTML='<p>Paste an image here with Ctrl+V, or enter an image URL.</p><label for="fallbackImage">Image URL or pasted image</label><textarea id="fallbackImage" rows="3"></textarea>';document.getElementById('slotModalFooter').innerHTML='<button type="button" class="slot-modal-btn cancel" id="fallbackCancel">Cancel</button><button type="button" class="slot-modal-btn submit" id="fallbackApply">Use image</button>';modalBackdrop.classList.add('open');const field=document.getElementById('fallbackImage');
    field.onpaste=e=>{const file=Array.from(e.clipboardData?.items||[]).find(i=>i.type.startsWith('image/'))?.getAsFile();if(!file)return;e.preventDefault();const reader=new FileReader();reader.onload=()=>{closeModal();queueImageForBatch(slotKey,reader.result,onApplyImage)};reader.readAsDataURL(file)};
    document.getElementById('fallbackCancel').onclick=closeModal;document.getElementById('fallbackApply').onclick=()=>{const url=field.value.trim();if(!/^(https?:\/\/|data:image\/|\/images\/)/.test(url)){showSlotToast('Enter a supported image URL or paste image pixels.',true);return}closeModal();queueImageForBatch(slotKey,url,onApplyImage)};field.focus();
  }

  // Open Comment Modal
  async function openDriveLibrary(slotKey, container, applyImage) {
    ensureModal();document.getElementById('slotModalTitle').textContent='Google Drive photo library';
    const body=document.getElementById('slotModalBody');body.replaceChildren();const source=document.createElement('a');source.href=container.dataset.driveUrl||DRIVE_FOLDER_URL;source.target='_blank';source.rel='noopener noreferrer';source.textContent='Open original in Google Drive';body.append(source);
    const search=document.createElement('input');search.placeholder='Search imported Drive photographs';search.style.cssText='width:100%;padding:10px;margin:14px 0';body.append(search);
    const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-height:440px;overflow:auto';body.append(grid);
    document.getElementById('slotModalFooter').innerHTML='<button type="button" class="slot-modal-btn cancel" id="libraryClose">Close</button>';document.getElementById('libraryClose').onclick=closeModal;modalBackdrop.classList.add('open');
    try{const r=await fetch('/image-provenance.json');if(!r.ok)throw Error('Library unavailable');const all=await r.json();const unique=[...new Map(all.filter(a=>a.src && a.driveUrl).map(a=>[a.src,a])).values()];
    function render(){grid.replaceChildren();for(const asset of unique.filter(a=>(a.source+' '+a.provenance).toLowerCase().includes(search.value.toLowerCase()))){const btn=document.createElement('button');btn.type='button';btn.style.cssText='border:1px solid #dce5ea;border-radius:8px;padding:6px;background:white;cursor:pointer';const image=document.createElement('img');image.src=asset.src;image.alt=asset.source;image.loading='lazy';image.style.cssText='width:100%;height:95px;object-fit:cover';btn.append(image);const label=document.createElement('span');label.textContent=asset.source+(asset.provenance==='AI_ILLUSTRATIVE'?' (illustration)':' (archive photograph)');label.style.cssText='font-size:10px;display:block;overflow-wrap:anywhere';btn.append(label);btn.onclick=()=>{queueImageForBatch(slotKey,asset.src,url=>{container.dataset.driveUrl=asset.driveUrl;applyImage(url);editorApi('drive',slotKey,{driveUrl:asset.driveUrl}).catch(e=>showSlotToast('Source link save failed: '+e.message,true))});closeModal()};grid.append(btn)}}render();search.oninput=render;
    }catch(e){showSlotToast(e.message,true)}
  }

  function openCommentModal(slotKey, updateBadge) {
    ensureModal();
    const title = document.getElementById('slotModalTitle');
    const body = document.getElementById('slotModalBody');
    const footer = document.getElementById('slotModalFooter');

    title.innerHTML = `💬 Slot Review & Notes: ${slotKey}`;

    const comments = getCommentsForSlot(slotKey);
    let historyHtml = '';
    if (comments.length > 0) {
      historyHtml = `
        <label>Previous Notes / Feedback (${comments.length})</label>
        <div class="comment-history">
          ${comments.map(c => `
            <div class="comment-entry">
              <div class="comment-meta">
                <span>👤 Reviewer</span>
                <span>${new Date(c.timestamp).toLocaleString()}</span>
              </div>
              <div class="comment-text">${escapeHtml(c.text)}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    body.innerHTML = `
      ${historyHtml}
      <label for="slotCommentText">Add Note / Critique for AI Agent</label>
      <textarea id="slotCommentText" class="slot-modal-textarea" placeholder="E.g. Too dark, please replace with bright morning light; or: Approved for production..."></textarea>
      <div style="font-size:0.75rem;color:#64748b">
        Notes are saved online for authorized reviewers. Review them in the review inbox.
      </div>
    `;

    footer.innerHTML = `
      <button class="slot-modal-btn cancel" id="slotCommentCancel" type="button">Close</button>
      <button class="slot-modal-btn submit" id="slotCommentSave" type="button">Save Note</button>
    `;

    document.getElementById('slotCommentCancel').addEventListener('click', closeModal);
    const textarea = document.getElementById('slotCommentText');
    setTimeout(() => textarea.focus(), 50);

    document.getElementById('slotCommentSave').addEventListener('click', async () => {
      const val = textarea.value.trim();
      if (!val) {
        closeModal();
        return;
      }
      if(!await promptForEditorPassword())return;
      try { await addCommentForSlot(slotKey, val); } catch(error) { showSlotToast('Note was not saved: '+error.message,true); return; }
      updateBadge();
      closeModal();
      showSlotToast('Note saved in the review inbox.');
    });

    modalBackdrop.classList.add('open');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // Initialize a Slot Container
  function setupSlot(container, slotIndex) {
    container.tabIndex=0;
    if (container.dataset.slotInitialized) return;
    container.dataset.slotInitialized = 'true';
    container.classList.add('slot-managed-item');

    const slotId = container.dataset.slotId || `SLOT-${String(slotIndex + 1).padStart(2, '0')}`;
    const slotKey = `${pagePath}::${slotId}`;

    // Find primary image inside container
    let img = container.querySelector('img');
    const isPlaceholder = !img || !img.getAttribute('src');
    const originalSource=img?.getAttribute('src')||'';

    // Check if slot has a saved custom image override in localStorage
    const savedCustomImg = getCustomImage(slotKey);

    // If placeholder or empty, convert to Empty Ready Slot
    if (isPlaceholder && !savedCustomImg) {
      container.classList.add('empty-ready-slot');
      const originalText = container.textContent.trim() || 'Empty Image Slot';
      container.innerHTML = `
        <span class="empty-icon">🖼️</span>
        <div class="empty-title">Ready Slot [${slotId}]</div>
        <div class="empty-subtitle">${escapeHtml(originalText)}</div>
        <div class="empty-quick-actions">
          <span style="font-size:0.78rem;color:#0284c7;font-weight:600">Drag & drop image here or click Paste</span>
        </div>
      `;
      img=null;
    }

    // Apply saved override if present
    if (savedCustomImg) {
      if (!img) {
        container.innerHTML = '';
        container.classList.remove('empty-ready-slot');
        img = document.createElement('img');
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        container.appendChild(img);
      }
      img.src = savedCustomImg;
      img.dataset.isCustom = 'true';
    }

    // Store original src for reset capability
    if (img && !img.dataset.origSrc) {
      img.dataset.origSrc = originalSource;
    }

    // Slot Label Badge
    const badgeLabel = document.createElement('div');
    badgeLabel.className = 'slot-badge-label';
    badgeLabel.textContent = slotId;
    container.appendChild(badgeLabel);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'slot-toolbar';
    if (isPlaceholder && !savedCustomImg) {
      toolbar.classList.add('always-visible');
    }

    // Helper to copy actual image blob to clipboard
    async function copyImageBlobToClipboard(imageEl) {
      if (!imageEl || !imageEl.src) {
        showSlotToast('No image available to copy.', true);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = imageEl.naturalWidth || imageEl.width || 800;
        canvas.height = imageEl.naturalHeight || imageEl.height || 600;
        const ctx = canvas.getContext('2d');
        const imgObj = new Image();
        imgObj.crossOrigin = 'anonymous';
        imgObj.onload = () => {
          ctx.drawImage(imgObj, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(async (blob) => {
            if (!blob) {
              showSlotToast('Failed to create image blob', true);
              return;
            }
            try {
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
              ]);
              showSlotToast(`📋 Image ${slotId} copied to clipboard!`);
            } catch (err) {
              // Fallback to copying URL if browser blocks blob write
              await navigator.clipboard.writeText(imageEl.src);
              showSlotToast(`📋 Image URL for ${slotId} copied to clipboard!`);
            }
          }, 'image/png');
        };
        imgObj.onerror = async () => {
          await navigator.clipboard.writeText(imageEl.src);
          showSlotToast(`📋 Image link for ${slotId} copied to clipboard!`);
        };
        imgObj.src = imageEl.src;
      } catch (e) {
        await navigator.clipboard.writeText(imageEl.src);
        showSlotToast(`📋 Image link for ${slotId} copied to clipboard!`);
      }
    }

    // 1. Copy Image Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'slot-btn btn-copy';
    copyBtn.type = 'button';
    copyBtn.title = 'Copy image to clipboard';
    copyBtn.innerHTML = '📋 <span>Copy</span>';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyImageBlobToClipboard(img);
    });

    // 1b. Copy Link Button
    const copyLinkBtn = document.createElement('button');
    copyLinkBtn.className = 'slot-btn';
    copyLinkBtn.type = 'button';
    copyLinkBtn.title = 'Copy direct link to image';
    copyLinkBtn.innerHTML = '🔗 <span>Copy Link</span>';
    copyLinkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentSrc = img ? img.src : '';
      if (!currentSrc) {
        showSlotToast('No image link to copy.', true);
        return;
      }
      navigator.clipboard.writeText(currentSrc).then(() => {
        showSlotToast(`🔗 Image link for ${slotId} copied to clipboard!`);
      }).catch(() => {
        showSlotToast('Failed to copy link', true);
      });
    });

    // 2. Paste Button (Password Protected)
    const pasteBtn = document.createElement('button');
    pasteBtn.className = 'slot-btn btn-paste';
    pasteBtn.type = 'button';
    pasteBtn.title = 'Paste image from clipboard; password required once per editing session';
    pasteBtn.innerHTML = '📥 <span>Paste</span>';
    pasteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPasteModal(slotKey, (newUrl) => {
        applyImageToSlot(newUrl);
      });
    });

    // 3. Open in Drive Button
    const driveBtn = document.createElement('button');
    driveBtn.className = 'slot-btn btn-drive';
    driveBtn.type = 'button';
    driveBtn.title = 'Open raw asset in Google Drive';
    driveBtn.innerHTML = '📁 <span>Drive</span>';
    driveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void openDriveLibrary(slotKey, container, applyImageToSlot);
    });

    // 4. Comment Button
    const commentBtn = document.createElement('button');
    commentBtn.className = 'slot-btn btn-comment';
    commentBtn.type = 'button';
    commentBtn.title = 'Add critique or comments for AI agent';

    function updateCommentBadge() {
      const comments = getCommentsForSlot(slotKey);
      if (comments.length > 0) {
        commentBtn.classList.add('has-comment');
        commentBtn.innerHTML = `💬 <span>Comment (${comments.length})</span><span class="comment-indicator-dot"></span>`;
      } else {
        commentBtn.classList.remove('has-comment');
        commentBtn.innerHTML = '💬 <span>Comment</span>';
      }
    }
    updateCommentBadge();

    commentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCommentModal(slotKey, updateCommentBadge);
    });

    // 5. Download Button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'slot-btn';
    downloadBtn.type = 'button';
    downloadBtn.title = 'Download current image';
    downloadBtn.innerHTML = '⬇️';
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!img || !img.src) {
        showSlotToast('No image available to download', true);
        return;
      }
      const a = document.createElement('a');
      a.href = img.src;
      a.download = `${slotId}-${Date.now()}.${img.src.startsWith("data:image/png")?"png":"webp"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    // 6. Reset Button (Requires Password)
    const resetBtn = document.createElement('button');
    resetBtn.className = 'slot-btn';
    resetBtn.type = 'button';
    resetBtn.title = 'Reset to original template image (Password protected)';
    resetBtn.innerHTML = '↺';
    resetBtn.style.display = savedCustomImg ? 'inline-flex' : 'none';
    resetBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if(!await promptForEditorPassword())return;
      if(!confirm('Reset this image to its original state? Saved review notes will remain.'))return;
      try{await editorApi('remove',slotKey,{})}catch(error){showSlotToast('Cloud reset failed: '+error.message,true);return}
      removeCustomImage(slotKey);
      if(remoteRecords[safeSlot(slotKey)])remoteRecords[safeSlot(slotKey)].url='';
      location.reload();
    });

        toolbar.appendChild(copyBtn);
    toolbar.appendChild(copyLinkBtn);
    toolbar.appendChild(pasteBtn);
    const uploadBtn=document.createElement('button');uploadBtn.type='button';uploadBtn.className='slot-btn';uploadBtn.textContent='Upload';
    uploadBtn.onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.onchange=()=>{const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>queueImageForBatch(slotKey,reader.result,applyImageToSlot);reader.readAsDataURL(file)};input.click()};toolbar.appendChild(uploadBtn);
    toolbar.appendChild(driveBtn);
    toolbar.appendChild(commentBtn);
    toolbar.appendChild(downloadBtn);
    toolbar.appendChild(resetBtn);
    container.appendChild(toolbar);
    container.addEventListener('paste', e=>{if(!document.body.classList.contains('editing')||e.target.matches('input,textarea'))return;const file=Array.from(e.clipboardData?.items||[]).find(item=>item.type.startsWith('image/'))?.getAsFile();if(!file)return;e.preventDefault();const reader=new FileReader();reader.onload=()=>queueImageForBatch(slotKey,reader.result,applyImageToSlot);reader.readAsDataURL(file)});

    // Apply Image Helper
    function applyImageToSlot(dataUrl) {
      if (!img) {
        container.innerHTML = '';
        container.classList.remove('empty-ready-slot');
        img = document.createElement('img');
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        container.appendChild(img);
        container.appendChild(badgeLabel);
        container.appendChild(toolbar);
      }
      img.src = dataUrl;
      img.dataset.isCustom = 'true';
      saveCustomImage(slotKey, dataUrl);
      resetBtn.style.display = 'inline-flex';
      toolbar.classList.remove('always-visible');

      // Two-way synchronization: If this slot is paired with a slider or card, update its twin
      if (container.onSlotUpdated) {
        try { container.onSlotUpdated(dataUrl); } catch(e){}
      }
    }

    // Drag & Drop Listeners (Queue through password batch bar)
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.add('drag-active');
    });

    container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.remove('drag-active');
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.remove('drag-active');

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (!file.type.startsWith('image/')) {
          showSlotToast('Dropped file must be an image (.png, .jpg, .webp)!', true);
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          const resultData = event.target.result;
          queueImageForBatch(slotKey, resultData, (newSrc) => {
            applyImageToSlot(newSrc);
          });
        };
        reader.readAsDataURL(file);
      }
    });

    // Lightbox zoom on clicking the image
    container.addEventListener('click', (e) => {
      if (e.target.closest('.slot-toolbar') || e.target.closest('.slot-modal')) return;
      if (img && img.src && !container.classList.contains('empty-ready-slot')) {
        openLightbox(img.src, img.alt);
      }
    });
  }

  // Scan and mount on all images and placeholders
  function scanAndMountSlots() {
    const selectors = [
      '.ph',
      '.placeholder',
      '[role="img"]',
      '.job-imgs > div',
      '.hero-img',
      '.scope-card .ph',
      '.photo-wrap'
    ];

    let foundSlots = [];
    document.querySelectorAll(selectors.join(', ')).forEach((el) => {
      if (!foundSlots.includes(el) && !el.closest('.ba') && !el.closest('.slot-toolbar')) {
        foundSlots.push(el);
      }
    });

    // Also include any standalone <img> that isn't wrapped in .ph, excluding anything in .ba
    document.querySelectorAll('main img, .hero img, section img').forEach((img) => {
      const parent = img.parentElement;
      if (parent && !foundSlots.includes(parent) && !parent.closest('.slot-managed-item') && !parent.closest('.ba') && !parent.classList.contains('ba-layer')) {
        foundSlots.push(parent);
      }
    });

    foundSlots.forEach((slotEl, idx) => {
      setupSlot(slotEl, idx);
    });

    // Setup interactive Before / After configuration on all .ba sliders
    document.querySelectorAll('.ba').forEach((baContainer, baIdx) => {
      if (baContainer.dataset.baConfigured) return;
      baContainer.dataset.baConfigured = 'true';

      const tagBefore = baContainer.querySelector('.ba-tag.b');
      const tagAfter = baContainer.querySelector('.ba-tag.a');
      let layerBefore = baContainer.querySelector('.ba-layer.ba-before img');
      let layerAfter = baContainer.querySelector('.ba-layer:not(.ba-before) img');

      // If .ba-layer doesn't contain an <img> element (e.g. empty template), create it
      if (!layerBefore) {
        const divBefore = baContainer.querySelector('.ba-layer.ba-before');
        if (divBefore) {
          layerBefore = document.createElement('img');
          layerBefore.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          divBefore.appendChild(layerBefore);
        }
      }
      if (!layerAfter) {
        const divAfter = baContainer.querySelector('.ba-layer:not(.ba-before)');
        if (divAfter) {
          layerAfter = document.createElement('img');
          layerAfter.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          divAfter.appendChild(layerAfter);
        }
      }

      if (tagBefore) {
        tagBefore.title = 'Click to configure or replace BEFORE image';
        tagBefore.addEventListener('click', (e) => {
          e.stopPropagation();
          const baKey = `${pagePath}::BA-${baIdx + 1}-BEFORE`;
          openPasteModal(baKey, (newSrc) => {
            if (layerBefore) {
              layerBefore.src = newSrc;
              saveCustomImage(baKey, newSrc);
            }
          });
        });
      }

      if (tagAfter) {
        tagAfter.title = 'Click to configure or replace AFTER image';
        tagAfter.addEventListener('click', (e) => {
          e.stopPropagation();
          const baKey = `${pagePath}::BA-${baIdx + 1}-AFTER`;
          openPasteModal(baKey, (newSrc) => {
            if (layerAfter) {
              layerAfter.src = newSrc;
              saveCustomImage(baKey, newSrc);
            }
          });
        });
      }

      // Check saved custom images for BA sliders
      const savedBefore = getCustomImage(`${pagePath}::BA-${baIdx + 1}-BEFORE`);
      if (savedBefore && layerBefore) layerBefore.src = savedBefore;
      const savedAfter = getCustomImage(`${pagePath}::BA-${baIdx + 1}-AFTER`);
      if (savedAfter && layerAfter) layerAfter.src = savedAfter;

      // Enable drag & drop directly onto slider (left side = before, right side = after)
      baContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      baContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        if (!file.type.startsWith('image/')) return;

        const rect = baContainer.getBoundingClientRect();
        const isLeft = (e.clientX - rect.left) < (rect.width / 2);
        const targetSide = isLeft ? 'BEFORE' : 'AFTER';
        const targetImg = isLeft ? layerBefore : layerAfter;
        const baKey = `${pagePath}::BA-${baIdx + 1}-${targetSide}`;

        const reader = new FileReader();
        reader.onload = (evt) => {
          const resultData = evt.target.result;
          queueImageForBatch(baKey, resultData, (src) => {
            if (targetImg) {
              targetImg.src = src;
              saveCustomImage(baKey, src);
            }
          });
        };
        reader.readAsDataURL(file);
      });
    });

    // Mount dedicated Before & After Slider Configuration Grid directly under .ba-wrap section
    const baWrap = document.querySelector('.ba-wrap');
    if (baWrap && !document.getElementById('ba-config-section')) {
      const parentSection = baWrap.closest('section') || baWrap.parentElement;
      const configSection = document.createElement('section');
      configSection.id = 'ba-config-section';
      configSection.className = 'ba-config-container';
      configSection.innerHTML = `
        <div class="wrap" style="padding-top:20px;padding-bottom:30px">
          <div style="margin-bottom:20px">
            <span class="eyebrow" style="color:#0284c7;font-weight:700;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px">⚙️ Slider Asset Management</span>
            <h3 style="font-size:1.35rem;font-weight:700;margin-top:4px;margin-bottom:6px">Before & After Individual Slot Configuration</h3>
            <p style="font-size:0.88rem;color:#64748b;margin:0">Configure, copy, paste, or replace individual Before and After images for all sliders above.</p>
          </div>
          <div class="ba-config-grid" id="baConfigGrid"></div>
        </div>
      `;
      parentSection.parentNode.insertBefore(configSection, parentSection.nextSibling);

      const gridEl = document.getElementById('baConfigGrid');
      document.querySelectorAll('.ba').forEach((baEl, idx) => {
        const pairNum = idx + 1;
        const imgBefore = baEl.querySelector('.ba-before img');
        const imgAfter = baEl.querySelector('.ba-layer:not(.ba-before) img');
        // Check saved custom images for BA sliders and cards using unified keys
        const keyBefore = `${pagePath}::SLIDER-${pairNum}-BEFORE`;
        const keyAfter = `${pagePath}::SLIDER-${pairNum}-AFTER`;
        const savedB = getCustomImage(keyBefore) || getCustomImage(`${pagePath}::BA-${pairNum}-BEFORE`);
        const savedA = getCustomImage(keyAfter) || getCustomImage(`${pagePath}::BA-${pairNum}-AFTER`);

        if (savedB && imgBefore) {
          imgBefore.src = savedB;
        }
        if (savedA && imgAfter) {
          imgAfter.src = savedA;
        }

        // Card Before
        const cardB = document.createElement('div');
        cardB.className = 'ba-config-card ph';
        cardB.dataset.slotId = `SLIDER-${pairNum}-BEFORE`;
        cardB.innerHTML = `
          <div class="ba-config-badge">SLIDER ${pairNum} · BEFORE</div>
          <img src="${imgBefore && imgBefore.src ? imgBefore.src : (savedB || '')}" alt="Slider ${pairNum} Before" style="width:100%;height:100%;object-fit:cover;display:block">
        `;
        gridEl.appendChild(cardB);
        // Connect twin updates to the actual slider Before layer
        cardB.onSlotUpdated = (newUrl) => {
          if (imgBefore) imgBefore.src = newUrl;
          saveCustomImage(keyBefore, newUrl);
          saveCustomImage(`${pagePath}::BA-${pairNum}-BEFORE`, newUrl);
        };
        setupSlot(cardB, 100 + (pairNum * 2) - 1);

        // Card After
        const cardA = document.createElement('div');
        cardA.className = 'ba-config-card ph';
        cardA.dataset.slotId = `SLIDER-${pairNum}-AFTER`;
        cardA.innerHTML = `
          <div class="ba-config-badge">SLIDER ${pairNum} · AFTER</div>
          <img src="${imgAfter && imgAfter.src ? imgAfter.src : (savedA || '')}" alt="Slider ${pairNum} After" style="width:100%;height:100%;object-fit:cover;display:block">
        `;
        gridEl.appendChild(cardA);
        // Connect twin updates to the actual slider After layer
        cardA.onSlotUpdated = (newUrl) => {
          if (imgAfter) imgAfter.src = newUrl;
          saveCustomImage(keyAfter, newUrl);
          saveCustomImage(`${pagePath}::BA-${pairNum}-AFTER`, newUrl);
        };
        setupSlot(cardA, 100 + (pairNum * 2));
      });
    }
  }

  // Load persisted cloud assignments and the HttpOnly session before mounting controls.
  async function startSlotManager(){
    await loadCloudState();
    scanAndMountSlots();
    setTimeout(scanAndMountSlots,600);
    setTimeout(scanAndMountSlots,1800);
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',startSlotManager);
  }else{
    void startSlotManager();
  }

  console.log('[Shining Services] Universal Slot Manager initialized on', pagePath);
})();

