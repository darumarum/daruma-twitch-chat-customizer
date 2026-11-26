(function () {
  'use strict';

  if (window.__TCC_PAGE_BRIDGE_INSTALLED__) return;
  window.__TCC_PAGE_BRIDGE_INSTALLED__ = true;

  const BRIDGE_CHANNEL = 'TCC_BRIDGE_V1';
  const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const KNOWN_AVAILABLE_EMOTES_HASH =
    'b9ce64d02e26c6fe9adbfb3991284224498b295542f9c5a51eacd3610e659cfb';

  const origFetch = window.fetch;
  const capturedHeaders = {};
  const learnedHashes = {
    AvailableEmotesForChannel: KNOWN_AVAILABLE_EMOTES_HASH
  };

  function postToContent(type, data) {
    try {
      window.postMessage(
        Object.assign({ channel: BRIDGE_CHANNEL, type }, data || {}),
        '*'
      );
    } catch (_) {
      // Ignore postMessage failures
    }
  }

  function extractHeadersMap(headersInit) {
    const out = {};
    if (!headersInit) return out;
    try {
      if (typeof Headers !== 'undefined' && headersInit instanceof Headers) {
        headersInit.forEach((v, k) => {
          out[String(k).toLowerCase()] = String(v);
        });
      } else if (Array.isArray(headersInit)) {
        for (let i = 0; i < headersInit.length; i++) {
          const pair = headersInit[i];
          if (Array.isArray(pair) && pair.length >= 2) {
            out[String(pair[0]).toLowerCase()] = String(pair[1]);
          }
        }
      } else if (typeof headersInit === 'object') {
        const keys = Object.keys(headersInit);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          out[String(k).toLowerCase()] = String(headersInit[k]);
        }
      }
    } catch (_) {}
    return out;
  }

  function captureAuthHeaders(headersObj) {
    const interesting = ['authorization', 'client-id', 'client-integrity', 'x-device-id'];
    for (let i = 0; i < interesting.length; i++) {
      const k = interesting[i];
      if (headersObj[k]) {
        capturedHeaders[k] = headersObj[k];
      }
    }
  }

  function learnFromRequestBody(body) {
    if (typeof body !== 'string' || body.length === 0) return;
    try {
      const parsed = JSON.parse(body);
      const ops = Array.isArray(parsed) ? parsed : [parsed];
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (!op || typeof op !== 'object') continue;
        const opName = op.operationName;
        const hash = op.extensions && op.extensions.persistedQuery && op.extensions.persistedQuery.sha256Hash;
        if (opName && hash && /emote/i.test(opName)) {
          learnedHashes[opName] = hash;
        }
      }
    } catch (_) {}
  }

  function payloadHasEmotesOrProfiles(data) {
    const visited = new WeakSet();
    let count = 0;
    function scan(node, depth) {
      if (!node || typeof node !== 'object' || depth > 8 || count > 200) return false;
      if (visited.has(node)) return false;
      visited.add(node);
      count++;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length && i < 60; i++) {
          if (scan(node[i], depth + 1)) return true;
        }
        return false;
      }
      if (
        Array.isArray(node.emotes) ||
        Array.isArray(node.availableEmotesForChannel) ||
        Array.isArray(node.emoteSets) ||
        Array.isArray(node.localEmoteSets) ||
        Array.isArray(node.followerEmoteSets) ||
        Array.isArray(node.subscriptionProducts) ||
        typeof node.profileImageURL === 'string'
      ) {
        return true;
      }
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const val = node[keys[i]];
        if (val && typeof val === 'object') {
          if (scan(val, depth + 1)) return true;
        }
      }
      return false;
    }
    return scan(data, 0);
  }

  // Non-destructive fetch hook for Twitch GQL
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || '';
      } catch (_) {}

      const isGql = url.includes('gql.twitch.tv/gql');
      if (isGql) {
        try {
          if (input && typeof input === 'object' && input.headers) {
            captureAuthHeaders(extractHeadersMap(input.headers));
          }
          if (init && init.headers) {
            captureAuthHeaders(extractHeadersMap(init.headers));
          }
          if (init && typeof init.body === 'string') {
            learnFromRequestBody(init.body);
          }
        } catch (_) {}
      }

      const promise = origFetch.apply(this, arguments);

      if (isGql && promise && typeof promise.then === 'function') {
        promise
          .then((res) => {
            if (!res || !res.ok || typeof res.clone !== 'function') return;
            res
              .clone()
              .json()
              .then((data) => {
                if (payloadHasEmotesOrProfiles(data)) {
                  postToContent('GQL_RESPONSE', { payload: data });
                }
              })
              .catch(() => {});
          })
          .catch(() => {});
      }

      return promise;
    };
  }

  function getCookie(name) {
    try {
      const cookies = document.cookie ? document.cookie.split(';') : [];
      for (let i = 0; i < cookies.length; i++) {
        const part = cookies[i].trim();
        if (part.startsWith(name + '=')) {
          return decodeURIComponent(part.slice(name.length + 1));
        }
      }
    } catch (_) {}
    return '';
  }

  function buildGqlHeaders() {
    const headers = {
      'Client-Id': capturedHeaders['client-id'] || DEFAULT_CLIENT_ID,
      'Content-Type': 'text/plain;charset=UTF-8'
    };
    const auth = capturedHeaders['authorization'];
    if (auth) {
      headers['Authorization'] = auth;
    } else {
      const token = getCookie('auth-token');
      if (token) {
        headers['Authorization'] = 'OAuth ' + token;
      }
    }
    if (capturedHeaders['client-integrity']) {
      headers['Client-Integrity'] = capturedHeaders['client-integrity'];
    }
    if (capturedHeaders['x-device-id']) {
      headers['X-Device-Id'] = capturedHeaders['x-device-id'];
    }
    return headers;
  }

  async function postGql(bodyObj) {
    const res = await origFetch.call(window, 'https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: buildGqlHeaders(),
      body: JSON.stringify(bodyObj)
    });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }
    return res.json();
  }

  function hasGraphqlErrors(resp) {
    if (!resp) return true;
    if (Array.isArray(resp)) {
      return resp.every((r) => !r || (Array.isArray(r.errors) && r.errors.length > 0 && !r.data));
    }
    return Boolean(Array.isArray(resp.errors) && resp.errors.length > 0 && !resp.data);
  }

  async function handleActiveFetchEmotes(msg) {
    const requestId = msg.requestId;
    const channelLogin = typeof msg.channelLogin === 'string' ? msg.channelLogin.trim().toLowerCase() : '';
    let channelID = '';
    let resolvedLogin = channelLogin;
    let fetchedAny = false;

    try {
      // Step A: Resolve currentUser and target channelID
      const contextQuery = channelLogin
        ? {
            query: `query TCC_ResolveContext($login: String!) {
              currentUser {
                id
                login
                displayName
                profileImageURL(width: 50)
              }
              user(login: $login) {
                id
                login
                displayName
                profileImageURL(width: 50)
              }
            }`,
            variables: { login: channelLogin }
          }
        : {
            query: `query TCC_CurrentUser {
              currentUser {
                id
                login
                displayName
                profileImageURL(width: 50)
              }
            }`,
            variables: {}
          };

      const ctxResp = await postGql(contextQuery);
      if (ctxResp && ctxResp.data) {
        postToContent('GQL_RESPONSE', { payload: ctxResp });
        channelID =
          (ctxResp.data.user && ctxResp.data.user.id) ||
          (ctxResp.data.currentUser && ctxResp.data.currentUser.id) ||
          '';
        resolvedLogin =
          (ctxResp.data.user && ctxResp.data.user.login) ||
          (ctxResp.data.currentUser && ctxResp.data.currentUser.login) ||
          channelLogin;
      }
    } catch (_) {}

    const strategies = [];

    if (channelID) {
      // Strategy 1: Persisted query AvailableEmotesForChannel
      strategies.push(() =>
        postGql([
          {
            operationName: 'AvailableEmotesForChannel',
            variables: { channelID, withOwner: true },
            extensions: {
              persistedQuery: {
                version: 1,
                sha256Hash: learnedHashes.AvailableEmotesForChannel || KNOWN_AVAILABLE_EMOTES_HASH
              }
            }
          }
        ])
      );

      // Strategy 2: Plain GQL availableEmotesForChannel
      strategies.push(() =>
        postGql({
          query: `query TCC_AvailableEmotes($channelID: ID!, $withOwner: Boolean!) {
            currentUser {
              id
              availableEmotesForChannel(channelID: $channelID, withOwner: $withOwner) {
                id
                owner {
                  id
                  login
                  displayName
                  profileImageURL(width: 50)
                }
                emotes {
                  id
                  token
                  assetType
                  setID
                }
              }
            }
          }`,
          variables: { channelID, withOwner: true }
        })
      );


    }

    // Strategy 3: currentUser.emoteSets (works on dashboard or channel-less pages too)
    strategies.push(() =>
      postGql({
        query: `query TCC_UserEmoteSets {
          currentUser {
            id
            emoteSets {
              id
              owner {
                id
                login
                displayName
                profileImageURL(width: 50)
              }
              emotes {
                id
                token
                assetType
                setID
              }
            }
          }
        }`,
        variables: {}
      })
    );

    const fetchedCatalogs = [];
    let completeChannelSnapshot = false;
    for (let i = 0; i < strategies.length; i++) {
      try {
        const resp = await strategies[i]();
        if (resp && !hasGraphqlErrors(resp) && payloadHasEmotesOrProfiles(resp)) {
          const entries = Array.isArray(resp) ? resp : [resp];
          const available = entries.some(entry =>
            Array.isArray(entry?.data?.currentUser?.availableEmotesForChannel) ||
            Array.isArray(entry?.data?.channel?.self?.availableEmoteSets));
          if (available || !channelID) {
            fetchedAny = true;
            fetchedCatalogs.push(...entries);
          }
          // emoteSets membership alone also includes follower/channel-scoped
          // sets. Prefer the actual usable-for-this-channel response.
          if (available) { completeChannelSnapshot = true; break; }
        }
      } catch (_) {}
    }

    // Replace stale permissions only from a complete usable-for-channel list.
    if (fetchedCatalogs.length) postToContent('GQL_RESPONSE', { payload: fetchedCatalogs, completeViewerSnapshot: completeChannelSnapshot || !channelID, permissionChannelId: channelID });
    postToContent('ACTIVE_FETCH_RESULT', {
      requestId,
      ok: fetchedAny,
      channelID,
      channelLogin: resolvedLogin
    });
  }

  async function handleFetchMissingAvatars(msg) {
    const ids = Array.isArray(msg.ownerIds) ? msg.ownerIds.filter(Boolean) : [];
    if (ids.length === 0) return;

    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      try {
        const resp = await postGql({
          query: `query TCC_UsersByIds($ids: [ID!]!) {
            users(ids: $ids) {
              id
              login
              displayName
              profileImageURL(width: 50)
            }
          }`,
          variables: { ids: batch }
        });
        if (resp && resp.data) {
          postToContent('GQL_RESPONSE', { payload: resp });
        }
      } catch (_) {}
    }
  }

  // --- Chat Input Emote Insertion ---
  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findVisibleChatInput() {
    const slateEls = document.querySelectorAll('[data-slate-editor="true"]');
    for (let i = 0; i < slateEls.length; i++) {
      if (isElementVisible(slateEls[i])) {
        return { kind: 'slate', el: slateEls[i] };
      }
    }
    const textareas = document.querySelectorAll(
      'textarea[data-a-target="chat-input"], [data-a-target="chat-input"]'
    );
    for (let i = 0; i < textareas.length; i++) {
      const el = textareas[i];
      if (isElementVisible(el)) {
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          return { kind: 'textarea', el };
        }
        if (el.getAttribute('contenteditable') === 'true') {
          return { kind: 'slate', el };
        }
      }
    }
    return null;
  }

  function isSlateEditorInstance(obj) {
    return (
      Boolean(obj) &&
      typeof obj === 'object' &&
      typeof obj.insertText === 'function' &&
      typeof obj.apply === 'function' &&
      Array.isArray(obj.children)
    );
  }

  function findSlateEditorFromDom(el) {
    const candidates = [];
    let cur = el;
    for (let i = 0; i < 6 && cur; i++) {
      candidates.push(cur);
      cur = cur.parentElement;
    }

    for (let c = 0; c < candidates.length; c++) {
      const domNode = candidates[c];
      const keys = Object.keys(domNode);
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactProps$') && !key.startsWith('__reactInternalInstance$')) {
          continue;
        }
        let val = domNode[key];
        if (key.startsWith('__reactProps$')) {
          if (val && isSlateEditorInstance(val.editor)) return val.editor;
          if (val && val.children && isSlateEditorInstance(val.children.props && val.children.props.editor)) {
            return val.children.props.editor;
          }
          continue;
        }
        // Traverse Fiber return chain
        let fiber = val;
        for (let step = 0; step < 45 && fiber; step++) {
          const propsList = [fiber.memoizedProps, fiber.pendingProps];
          for (let p = 0; p < propsList.length; p++) {
            const props = propsList[p];
            if (!props || typeof props !== 'object') continue;
            if (isSlateEditorInstance(props.editor)) return props.editor;
            if (isSlateEditorInstance(props.value)) return props.value;
            if (props.value && isSlateEditorInstance(props.value.editor)) return props.value.editor;
          }
          if (fiber.stateNode && isSlateEditorInstance(fiber.stateNode.editor)) {
            return fiber.stateNode.editor;
          }
          fiber = fiber.return;
        }
      }
    }
    return null;
  }

  function getSlateSnapshot(editor, domEl) {
    let inlineCount = 0;
    let blockCount = 0;
    const parts = [];

    if (editor && Array.isArray(editor.children)) {
      blockCount = editor.children.length;
      function collect(nodes) {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (!n || typeof n !== 'object') continue;
          if (typeof n.text === 'string') {
            parts.push(n.text);
            continue;
          }
          const isEmoteType = typeof n.type === 'string' && /emote/i.test(n.type);
          let isInline = isEmoteType;
          if (!isInline && typeof editor.isInline === 'function') {
            try {
              isInline = Boolean(editor.isInline(n));
            } catch (_) {}
          }
          if (isInline) {
            inlineCount++;
            const tok =
              n.emoteToken ||
              n.token ||
              n.code ||
              n.alt ||
              n.name ||
              (n.emote && (n.emote.token || n.emote.code || n.emote.name)) ||
              '';
            if (typeof tok === 'string' && tok) {
              parts.push(tok);
            }
          }
          if (Array.isArray(n.children)) {
            collect(n.children);
          }
        }
      }
      collect(editor.children);
    }

    const domText = domEl && domEl.textContent ? domEl.textContent : '';
    const rawText = parts.length > 0 ? parts.join('') : domText;
    const text = rawText.replace(/[\uFEFF\u200B]/g, '');
    const imgCount = domEl ? domEl.querySelectorAll('img').length : 0;

    return { text, inlineCount, blockCount, imgCount };
  }

  function didSlateSnapshotGrow(before, after, token) {
    if (!before || !after) return false;
    return (
      after.imgCount > before.imgCount ||
      after.inlineCount > before.inlineCount ||
      after.text.length > before.text.length ||
      (Boolean(token) && !before.text.includes(token) && after.text.includes(token))
    );
  }

  function hasBadInsertedArtifact(beforeText, afterText, token) {
    const b = beforeText || '';
    const a = afterText || '';
    if (a.includes('[object Object]') && !b.includes('[object Object]')) return true;
    if (
      (!token || !String(token).includes('undefined')) &&
      a.includes('undefined') &&
      !b.includes('undefined')
    ) {
      return true;
    }
    return false;
  }

  function getEndPoint(editor) {
    if (!editor || !Array.isArray(editor.children) || editor.children.length === 0) return null;
    const path = [];
    let node = editor;
    while (node && Array.isArray(node.children) && node.children.length > 0) {
      const idx = node.children.length - 1;
      path.push(idx);
      node = node.children[idx];
    }
    if (node && typeof node.text === 'string') {
      return { path, offset: node.text.length };
    }
    return null;
  }

  function findLastTextPointInNode(node, basePath) {
    if (!node || typeof node !== 'object') return null;
    if (typeof node.text === 'string') {
      return { path: basePath, offset: node.text.length };
    }
    if (!Array.isArray(node.children) || node.children.length === 0) return null;
    for (let idx = node.children.length - 1; idx >= 0; idx--) {
      const res = findLastTextPointInNode(node.children[idx], basePath.concat(idx));
      if (res) return res;
    }
    return null;
  }

  function isSlateBlockCompletelyEmpty(node, editor) {
    if (!node || typeof node !== 'object') return true;
    if (typeof node.text === 'string') {
      return node.text.replace(/[\uFEFF\u200B]/g, '').length === 0;
    }
    if (typeof node.type === 'string' && /emote/i.test(node.type)) {
      return false;
    }
    if (
      editor &&
      ((typeof editor.isInline === 'function' && editor.isInline(node)) ||
        (typeof editor.isVoid === 'function' && editor.isVoid(node)))
    ) {
      return false;
    }
    if (!Array.isArray(node.children)) {
      return false;
    }
    for (let i = 0; i < node.children.length; i++) {
      if (!isSlateBlockCompletelyEmpty(node.children[i], editor)) {
        return false;
      }
    }
    return true;
  }

  function setSlateSelectionSafely(editor, range) {
    if (!editor || !range) return;
    if (typeof editor.select === 'function') {
      editor.select(range);
      return;
    }
    if (typeof editor.apply === 'function') {
      editor.apply({
        type: 'set_selection',
        properties: editor.selection || null,
        newProperties: range
      });
    }
  }

  function selectSlateEndSafely(editor) {
    if (!editor || editor.selection) return;
    const endPoint = getEndPoint(editor);
    if (!endPoint) return;
    setSlateSelectionSafely(editor, { anchor: endPoint, focus: endPoint });
  }

  function cleanupTrailingEmptySlateBlocks(editor) {
    if (
      !editor ||
      !Array.isArray(editor.children) ||
      editor.children.length <= 1 ||
      typeof editor.apply !== 'function'
    ) {
      return;
    }
    try {
      let removedAny = false;
      for (let i = editor.children.length - 1; i >= 1; i--) {
        const block = editor.children[i];
        if (!isSlateBlockCompletelyEmpty(block, editor)) {
          break;
        }
        const sel = editor.selection;
        const selInBlock =
          sel &&
          ((sel.anchor && Array.isArray(sel.anchor.path) && sel.anchor.path[0] === i) ||
            (sel.focus && Array.isArray(sel.focus.path) && sel.focus.path[0] === i));
        if (selInBlock) {
          const prevPoint = findLastTextPointInNode(editor.children[i - 1], [i - 1]);
          if (prevPoint) {
            setSlateSelectionSafely(editor, { anchor: prevPoint, focus: prevPoint });
          }
        }
        editor.apply({ type: 'remove_node', path: [i], node: block });
        removedAny = true;
      }
      if (removedAny && typeof editor.onChange === 'function') {
        editor.onChange();
      }
    } catch (_) {}
  }

  function needsLeadingSpace(editor, cleanBefore) {
    if (editor && editor.selection && editor.selection.focus) {
      try {
        const focus = editor.selection.focus;
        let parent = null;
        let node = editor;
        for (let i = 0; i < focus.path.length; i++) {
          parent = node;
          node = node && node.children && node.children[focus.path[i]];
        }
        if (node && typeof node.text === 'string') {
          if (focus.offset > 0) {
            return !/\s$/.test(node.text.slice(0, focus.offset));
          }
          if (focus.path.length >= 2 && parent && Array.isArray(parent.children)) {
            const idx = focus.path[focus.path.length - 1];
            if (idx > 0) {
              const prev = parent.children[idx - 1];
              if (prev && typeof prev === 'object') {
                if (typeof prev.text === 'string') {
                  return prev.text.length > 0 && !/\s$/.test(prev.text);
                }
                // Preceding sibling is an inline element (e.g. an emote node)
                return true;
              }
            }
            return false;
          }
        }
      } catch (_) {}
    }
    return cleanBefore.length > 0 && !/\s$/.test(cleanBefore);
  }

  const EMOTE_HANDLER_KEYS = [
    'onEmoteClick',
    'onSelectEmote',
    'onInsertEmote',
    'insertEmote',
    'handleEmoteClick',
    'handleSelectEmote',
    'onEmoteSelect',
    'appendEmote',
    'onClickEmote'
  ];

  function collectEmoteHandlersFromObject(obj, handlers, seenFns) {
    if (!obj || typeof obj !== 'object') return;
    for (let i = 0; i < EMOTE_HANDLER_KEYS.length; i++) {
      const key = EMOTE_HANDLER_KEYS[i];
      const fn = obj[key];
      if (typeof fn === 'function' && !seenFns.has(fn)) {
        seenFns.add(fn);
        handlers.push({ fn, thisArg: obj, key });
      }
    }
  }

  function findTwitchEmoteHandlers(slateEl, editor) {
    const handlers = [];
    const seenFns = new Set();

    if (editor) {
      const directKeys = ['insertEmote', 'insertChatEmote', 'insertEmoteNode'];
      for (let i = 0; i < directKeys.length; i++) {
        const fn = editor[directKeys[i]];
        if (typeof fn === 'function' && !seenFns.has(fn)) {
          seenFns.add(fn);
          handlers.push({ fn, thisArg: editor, key: directKeys[i] });
        }
      }
    }

    const startNodes = [
      document.querySelector('[data-a-target="emote-picker-button"]'),
      slateEl,
      slateEl && slateEl.closest ? slateEl.closest('.chat-input') : null
    ];

    for (let n = 0; n < startNodes.length; n++) {
      const domNode = startNodes[n];
      if (!domNode) continue;
      const keys = Object.keys(domNode);
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        if (key.startsWith('__reactProps$')) {
          collectEmoteHandlersFromObject(domNode[key], handlers, seenFns);
          continue;
        }
        if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) {
          continue;
        }
        let fiber = domNode[key];
        for (let step = 0; step < 35 && fiber; step++) {
          collectEmoteHandlersFromObject(fiber.memoizedProps, handlers, seenFns);
          collectEmoteHandlersFromObject(fiber.stateNode, handlers, seenFns);
          let hook = fiber.memoizedState;
          for (let h = 0; h < 30 && hook; h++) {
            if (hook.memoizedState && typeof hook.memoizedState === 'object' && hook.memoizedState.current) {
              collectEmoteHandlersFromObject(hook.memoizedState.current, handlers, seenFns);
            }
            if (hook.current && typeof hook.current === 'object') {
              collectEmoteHandlersFromObject(hook.current, handlers, seenFns);
            }
            hook = hook.next;
          }
          fiber = fiber.return;
        }
      }
    }

    return handlers;
  }

  function detectHandlerArgStyle(fn) {
    try {
      const src = Function.prototype.toString.call(fn);
      if (/(?:\.token|\.emoteToken|\.code|\.emoteID|\.emoteId|\.setID|\.assetType|\{\s*(?:token|id|emoteID|emoteId)\b)/.test(src)) {
        return 'object-first';
      }
    } catch (_) {}
    return 'string-first';
  }

  function tryInvokeNativeEmoteHandler(entry, emoteInfo, editor, slateEl, before) {
    const emoteObj = {
      id: emoteInfo.emoteId,
      emoteID: emoteInfo.emoteId,
      emoteId: emoteInfo.emoteId,
      token: emoteInfo.token,
      code: emoteInfo.token,
      name: emoteInfo.token,
      text: emoteInfo.token,
      setID: emoteInfo.setId,
      setId: emoteInfo.setId,
      assetType: emoteInfo.assetType
    };
    const style = detectHandlerArgStyle(entry.fn);
    const argsToTry = style === 'object-first' ? [emoteObj, emoteInfo.token] : [emoteInfo.token, emoteObj];

    for (let i = 0; i < argsToTry.length; i++) {
      try {
        entry.fn.call(entry.thisArg, argsToTry[i]);
      } catch (_) {
        continue;
      }
      const after = getSlateSnapshot(editor, slateEl);
      if (hasBadInsertedArtifact(before.text, after.text, emoteInfo.token)) {
        if (editor && typeof editor.undo === 'function') {
          try {
            editor.undo();
          } catch (_) {}
        }
        continue;
      }
      if (didSlateSnapshotGrow(before, after, emoteInfo.token)) {
        cleanupTrailingEmptySlateBlocks(editor);
        return {
          ok: true,
          converted: after.imgCount > before.imgCount || after.inlineCount > before.inlineCount
        };
      }
    }
    return { ok: false };
  }

  function placeDomCaretAtEnd(el) {
    try {
      const sel = window.getSelection();
      if (!sel) return;
      if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function syncTextareaRows(textarea) {
    if (!textarea || textarea.tagName !== 'TEXTAREA' || !textarea.isConnected) return;
    try {
      const val = textarea.value || '';
      if (!val) {
        if (textarea.getAttribute('rows') !== '1') {
          textarea.setAttribute('rows', '1');
        }
        return;
      }
      const prevRows = textarea.getAttribute('rows');
      const prevHeight = textarea.style.height;
      textarea.style.height = 'auto';
      textarea.setAttribute('rows', '1');

      const cs = getComputedStyle(textarea);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBot = parseFloat(cs.paddingBottom) || 0;
      const fontSize = parseFloat(cs.fontSize) || 13;
      const parsedLh = parseFloat(cs.lineHeight);
      const lineHeight = Number.isFinite(parsedLh) && parsedLh > 0 ? parsedLh : fontSize * 1.5;

      const contentH = Math.max(0, textarea.scrollHeight - padTop - padBot - 3);
      const neededRows = Math.max(1, Math.min(5, Math.ceil(contentH / lineHeight)));

      textarea.style.height = prevHeight;
      if (String(neededRows) !== prevRows) {
        textarea.setAttribute('rows', String(neededRows));
      } else if (prevRows != null) {
        textarea.setAttribute('rows', prevRows);
      }
    } catch (_) {}
  }

  function scheduleSyncTextareaRows(textarea) {
    if (!textarea || textarea.tagName !== 'TEXTAREA') return;
    syncTextareaRows(textarea);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => syncTextareaRows(textarea));
    }
    setTimeout(() => syncTextareaRows(textarea), 40);
  }

  function findTwitchChatInputController(el) {
    if (!el) return null;
    const keys = Object.keys(el);
    let fiberKey = null;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].startsWith('__reactFiber$') || keys[i].startsWith('__reactInternalInstance$')) {
        fiberKey = keys[i];
        break;
      }
    }
    if (!fiberKey) return null;

    let setInputValue = null;
    let setFiber = null;
    let valueFiber = null;
    let stateNode = null;

    let fiber = el[fiberKey];
    for (let step = 0; step < 25 && fiber; step++) {
      const p = fiber.memoizedProps;
      if (p && typeof p === 'object') {
        if (!setInputValue && typeof p.setInputValue === 'function') {
          setInputValue = p.setInputValue;
          setFiber = fiber;
        }
        if (!valueFiber && (typeof p.value === 'string' || typeof p.inputValue === 'string')) {
          valueFiber = fiber;
        }
      }
      if (
        !stateNode &&
        fiber.stateNode &&
        typeof fiber.stateNode === 'object' &&
        !(fiber.stateNode instanceof Element) &&
        (typeof fiber.stateNode.getCurrentCursorPosition === 'function' ||
          typeof fiber.stateNode.setCursorSelection === 'function' ||
          typeof fiber.stateNode.onEditableValueUpdate === 'function')
      ) {
        stateNode = fiber.stateNode;
      }
      fiber = fiber.return;
    }

    if (!setInputValue) return null;
    return {
      setInputValue,
      stateNode,
      getControlledValue() {
        const vp = valueFiber && valueFiber.memoizedProps;
        if (vp && typeof vp.value === 'string') return vp.value;
        if (vp && typeof vp.inputValue === 'string') return vp.inputValue;
        const sp = setFiber && setFiber.memoizedProps;
        if (sp && typeof sp.value === 'string') return sp.value;
        if (sp && typeof sp.inputValue === 'string') return sp.inputValue;
        return null;
      }
    };
  }

  function insertIntoTextarea(textarea, token, appendSpace) {
    try {
      textarea.focus({ preventScroll: true });
      const val = textarea.value || '';
      const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : val.length;
      const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : val.length;
      const before = val.slice(0, start);
      const after = val.slice(end);

      const needLead = before.length > 0 && !/\s$/.test(before);
      const needTrail = after.length > 0 ? !/^\s/.test(after) : appendSpace;
      const inserted = (needLead ? ' ' : '') + token + (needTrail ? ' ' : '');
      const nextVal = before + inserted + after;

      const proto = textarea.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(textarea, nextVal);
      } else {
        textarea.value = nextVal;
      }
      const nextCaret = before.length + inserted.length;
      if (typeof textarea.setSelectionRange === 'function') {
        textarea.setSelectionRange(nextCaret, nextCaret);
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      scheduleSyncTextareaRows(textarea);
      return true;
    } catch (_) {
      return false;
    }
  }

  function waitNextAnimationFrame() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 16);
      }
    });
  }

  async function handleInsertEmote(msg) {
    const requestId = msg.requestId;
    const token = typeof msg.token === 'string' ? msg.token.replace(/[\r\n]+/g, ' ').trim() : '';
    const emoteId = typeof msg.emoteId === 'string' ? msg.emoteId.trim() : '';
    const setId = typeof msg.setId === 'string' ? msg.setId.trim() : '';
    const assetType = typeof msg.assetType === 'string' ? msg.assetType.trim() : 'STATIC';
    const appendSpace = msg.appendSpace !== false;

    if (!token) {
      postToContent('INSERT_EMOTE_RESULT', { requestId, ok: false, reason: 'empty_token' });
      return;
    }

    const target = findVisibleChatInput();
    if (!target) {
      postToContent('INSERT_EMOTE_RESULT', { requestId, ok: false, reason: 'no_input' });
      return;
    }

    const initialEditor = target.kind === 'slate' ? findSlateEditorFromDom(target.el) : null;
    const initialSnap = target.kind === 'slate' ? getSlateSnapshot(initialEditor, target.el) : null;

    // Use the browser input event path so Twitch maps selections while normalizing.
    if (target.kind === 'slate') {
      try {
        target.el.focus({ preventScroll: true });
        placeDomCaretAtEnd(target.el);
        const dt = new DataTransfer();
        const insertion = (needsLeadingSpace(initialEditor, initialSnap.text) ? ' ' : '') + token + (appendSpace ? ' ' : '');
        dt.setData('text/plain', insertion);
        target.el.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt
        }));
        await waitNextAnimationFrame();
        const afterPaste = getSlateSnapshot(initialEditor, target.el);
        if (didSlateSnapshotGrow(initialSnap, afterPaste, token)) {
          postToContent('INSERT_EMOTE_RESULT', {requestId, ok: true, method: 'twitch_paste',
            convertedToEmote: afterPaste.imgCount > initialSnap.imgCount || afterPaste.inlineCount > initialSnap.inlineCount});
          return;
        }
      } catch (_) {}
    }

    // Preserve Twitch's inline emote nodes and selection through its own insertion API.
    if (target.kind === 'slate') {
      const handlers = findTwitchEmoteHandlers(target.el, initialEditor);
      const emoteInfo = { token, emoteId, setId, assetType };
      for (const handler of handlers) {
        const result = tryInvokeNativeEmoteHandler(handler, emoteInfo, initialEditor, target.el, initialSnap);
        if (result.ok) {
          postToContent('INSERT_EMOTE_RESULT', { requestId, ok: true,
            method: 'twitch_native_handler:' + handler.key, convertedToEmote: result.converted });
          return;
        }
      }
    }

    // Textarea controllers use character offsets. Slate owns its inline-node selection.
    const controller = target.kind === 'textarea' ? findTwitchChatInputController(target.el) : null;
    if (controller) {
      try {
        const currentVal = target.el.value || '';
        const start = Math.max(0, Math.min(currentVal.length,
          typeof target.el.selectionStart === 'number' ? target.el.selectionStart : currentVal.length));
        const end = Math.max(start, Math.min(currentVal.length,
          typeof target.el.selectionEnd === 'number' ? target.el.selectionEnd : start));
        const beforeText = currentVal.slice(0, start);
        const afterText = currentVal.slice(end);
        const needLead = beforeText.length > 0 && !/\s$/.test(beforeText);
        const needTrail = afterText.length > 0 ? !/^\s/.test(afterText) : appendSpace;
        const inserted = (needLead ? ' ' : '') + token + (needTrail ? ' ' : '');
        const nextVal = beforeText + inserted + afterText;
        const nextCaret = beforeText.length + inserted.length;
        controller.setInputValue(nextVal);
        await waitNextAnimationFrame();
        const liveTarget = findVisibleChatInput() || target;
        if (liveTarget.kind === 'textarea' && liveTarget.el.value === nextVal) {
          liveTarget.el.focus({ preventScroll: true });
          if (typeof liveTarget.el.setSelectionRange === 'function') {
            liveTarget.el.setSelectionRange(nextCaret, nextCaret);
          }
          scheduleSyncTextareaRows(liveTarget.el);
          postToContent('INSERT_EMOTE_RESULT', {requestId, ok: true, method: 'twitch_setInputValue'});
          return;
        }
      } catch (_) {}
    }

    // Tier 2: Direct textarea fallback
    if (target.kind === 'textarea') {
      const ok = insertIntoTextarea(target.el, token, appendSpace);
      postToContent('INSERT_EMOTE_RESULT', { requestId, ok, method: 'textarea' });
      return;
    }

    // Tier 3: Safe Slate fallback (no direct editor.selection mutation, no synchronous beforeinput)
    const slateEl = target.el;
    const editor = initialEditor;
    const needLead = needsLeadingSpace(editor, initialSnap.text);
    const textToInsert = (needLead ? ' ' : '') + token + (appendSpace ? ' ' : '');

    if (editor) {
      try {
        if (document.activeElement !== slateEl) {
          slateEl.focus({ preventScroll: true });
        }
        selectSlateEndSafely(editor);

        const before = getSlateSnapshot(editor, slateEl);
        const emoteInfo = { token, emoteId, setId, assetType };

        const handlers = findTwitchEmoteHandlers(slateEl, editor);
        for (let i = 0; i < handlers.length; i++) {
          const res = tryInvokeNativeEmoteHandler(handlers[i], emoteInfo, editor, slateEl, before);
          if (res.ok) {
            postToContent('INSERT_EMOTE_RESULT', {
              requestId,
              ok: true,
              method: 'twitch_native_handler',
              convertedToEmote: res.converted
            });
            return;
          }
        }

        // One transaction lets Twitch normalize emotes and map the caret together.
        const insertion = (needsLeadingSpace(editor, before.text) ? ' ' : '') + token + (appendSpace ? ' ' : '');
        editor.insertText(insertion);
        await waitNextAnimationFrame();
        cleanupTrailingEmptySlateBlocks(editor);
        const after = getSlateSnapshot(editor, slateEl);
        if (didSlateSnapshotGrow(before, after, token)) {
          postToContent('INSERT_EMOTE_RESULT', {
            requestId,
            ok: true,
            method: 'slate_insert_text',
            convertedToEmote: after.imgCount > before.imgCount || after.inlineCount > before.inlineCount
          });
          return;
        }
      } catch (_) {}
    }

    // Tier 4: InputEvent / ClipboardEvent / execCommand DOM fallbacks
    if (document.activeElement !== slateEl) {
      slateEl.focus({ preventScroll: true });
    }
    placeDomCaretAtEnd(slateEl);

    function domChanged() {
      const nowSnap = getSlateSnapshot(editor, slateEl);
      return didSlateSnapshotGrow(initialSnap, nowSnap, token);
    }

    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', textToInsert);
      slateEl.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertFromPaste',
          dataTransfer: dt
        })
      );
      if (domChanged()) {
        cleanupTrailingEmptySlateBlocks(editor);
        postToContent('INSERT_EMOTE_RESULT', { requestId, ok: true, method: 'beforeinput_paste' });
        return;
      }
    } catch (_) {}

    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', textToInsert);
      slateEl.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        })
      );
      if (domChanged()) {
        cleanupTrailingEmptySlateBlocks(editor);
        postToContent('INSERT_EMOTE_RESULT', { requestId, ok: true, method: 'clipboard_paste' });
        return;
      }
    } catch (_) {}

    try {
      slateEl.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: textToInsert
        })
      );
      slateEl.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          inputType: 'insertText',
          data: textToInsert
        })
      );
      if (domChanged()) {
        cleanupTrailingEmptySlateBlocks(editor);
        postToContent('INSERT_EMOTE_RESULT', { requestId, ok: true, method: 'input_event' });
        return;
      }
    } catch (_) {}

    try {
      if (document.execCommand('insertText', false, textToInsert) && domChanged()) {
        cleanupTrailingEmptySlateBlocks(editor);
        postToContent('INSERT_EMOTE_RESULT', { requestId, ok: true, method: 'execCommand' });
        return;
      }
    } catch (_) {}

    postToContent('INSERT_EMOTE_RESULT', { requestId, ok: false, reason: 'all_strategies_failed' });
  }

  const insertQueue = [];
  let isProcessingInsert = false;

  async function drainInsertQueue() {
    if (isProcessingInsert) return;
    isProcessingInsert = true;
    try {
      while (insertQueue.length > 0) {
        const msg = insertQueue.shift();
        try {
          await handleInsertEmote(msg);
        } catch (_) {
          if (msg && msg.requestId) {
            postToContent('INSERT_EMOTE_RESULT', {
              requestId: msg.requestId,
              ok: false,
              reason: 'unexpected_error'
            });
          }
        }
      }
    } finally {
      isProcessingInsert = false;
      if (insertQueue.length > 0) {
        drainInsertQueue();
      }
    }
  }

  function enqueueInsertEmote(msg) {
    insertQueue.push(msg);
    drainInsertQueue();
  }

  document.addEventListener(
    'input',
    (e) => {
      const t = e && e.target;
      if (t && t.tagName === 'TEXTAREA' && t.getAttribute('data-a-target') === 'chat-input') {
        scheduleSyncTextareaRows(t);
      }
    },
    { capture: true, passive: true }
  );

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== BRIDGE_CHANNEL) return;

    if (data.type === 'ACTIVE_FETCH_EMOTES') {
      handleActiveFetchEmotes(data);
    } else if (data.type === 'FETCH_MISSING_AVATARS') {
      handleFetchMissingAvatars(data);
    } else if (data.type === 'INSERT_EMOTE') {
      enqueueInsertEmote(data);
    }
  });
})();
