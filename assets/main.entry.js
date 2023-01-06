function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}
function subscribe(store, ...callbacks) {
    if (store == null) {
        return noop;
    }
    const unsub = store.subscribe(...callbacks);
    return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function get_store_value(store) {
    let value;
    subscribe(store, _ => value = _)();
    return value;
}
function component_subscribe(component, store, callback) {
    component.$$.on_destroy.push(subscribe(store, callback));
}
function set_store_value(store, ret, value = ret) {
    store.set(value);
    return ret;
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function empty() {
    return text('');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_data(text, data) {
    data = '' + data;
    if (text.wholeText !== data)
        text.data = data;
}
function toggle_class(element, name, toggle) {
    element.classList[toggle ? 'add' : 'remove'](name);
}
function custom_event(type, detail) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, false, false, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail);
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
        }
    };
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
let flushing = false;
const seen_callbacks = new Set();
function flush() {
    if (flushing)
        return;
    flushing = true;
    do {
        // first, call beforeUpdate functions
        // and update components
        for (let i = 0; i < dirty_components.length; i += 1) {
            const component = dirty_components[i];
            set_current_component(component);
            update(component.$$);
        }
        set_current_component(null);
        dirty_components.length = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    flushing = false;
    seen_callbacks.clear();
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
}
function create_component(block) {
    block && block.c();
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(parent_component ? parent_component.$$.context : options.context || []),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

const subscriber_queue = [];
/**
 * Creates a `Readable` store that allows reading by subscription.
 * @param value initial value
 * @param {StartStopNotifier}start start and stop notifications for subscriptions
 */
function readable(value, start) {
    return {
        subscribe: writable(value, start).subscribe
    };
}
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = [];
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (let i = 0; i < subscribers.length; i += 1) {
                    const s = subscribers[i];
                    s[1]();
                    subscriber_queue.push(s, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.push(subscriber);
        if (subscribers.length === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) {
                subscribers.splice(index, 1);
            }
            if (subscribers.length === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}
function derived(stores, fn, initial_value) {
    const single = !Array.isArray(stores);
    const stores_array = single
        ? [stores]
        : stores;
    const auto = fn.length < 2;
    return readable(initial_value, (set) => {
        let inited = false;
        const values = [];
        let pending = 0;
        let cleanup = noop;
        const sync = () => {
            if (pending) {
                return;
            }
            cleanup();
            const result = fn(single ? values[0] : values, set);
            if (auto) {
                set(result);
            }
            else {
                cleanup = is_function(result) ? result : noop;
            }
        };
        const unsubscribers = stores_array.map((store, i) => subscribe(store, (value) => {
            values[i] = value;
            pending &= ~(1 << i);
            if (inited) {
                sync();
            }
        }, () => {
            pending |= (1 << i);
        }));
        inited = true;
        sync();
        return function stop() {
            run_all(unsubscribers);
            cleanup();
        };
    });
}

function sendEvent({ type, label, value }) {
  if (!window.panelbear) return;

  window.panelbear('track', [type, label, value].filter(Boolean).join('.'));
}

const raf = window.requestAnimationFrame;
const timeout = window.setTimeout;
const { body } = document;
const { location } = window;
const { hostname } = location;

const waitFor = (ms) => new Promise((res) => timeout(res, ms));

const LOADING_STATE = {
  None: 0,
  Loading: 1,
  Done: 2,
};

// used for toggling
let prevVolume = null;

const tvEl = document.querySelector('.js-tv');
const screenEl = tvEl.querySelector('.js-screen');
const contentEl = screenEl.querySelector('.js-content');

const contentVisible = writable(true);
const volume = writable(0.25);
const currentChannel = writable(0);
const loadingChannel = writable(LOADING_STATE.None);
const loadingPage = writable(LOADING_STATE.None);

const channelMap = {
  0: {},
  1: { type: 'video', duration: null, startTimestamp: null },
  2: { type: 'video', duration: null, startTimestamp: null },
  3: { type: 'video', duration: null, startTimestamp: null },
  4: { type: 'video', duration: null, startTimestamp: null },
  5: { type: 'video', duration: null, startTimestamp: null },
  6: { type: 'video', duration: null, startTimestamp: null },
  7: { type: 'video', duration: null, startTimestamp: null },
  8: { type: 'video', duration: null, startTimestamp: null },
  9: { type: 'webcam', displayName: 'AV1' },
};

const channelIds = Object.keys(channelMap);

const currentChannelInfo = derived(
  [currentChannel],
  ([$currentChannel]) => {
    return {
      displayName: $currentChannel.toString().padStart(2, '0'),
      number: $currentChannel,
      type: 'unknown',
      ...channelMap[$currentChannel],
    };
  },
);

const updateChannelInfo = (number, info) => {
  channelMap[number] = {
    ...channelMap[number],
    ...info,
  };
};

const incrementChannel = () => {
  currentChannel.update((n) => {
    const newValue = n + 1;

    if (newValue >= channelIds.length) {
      return 0;
    }

    return newValue;
  });
};

const gotoChannel = (n) => {
  currentChannel.set(n);
};

const decrementChannel = () => {
  currentChannel.update((n) => {
    const newValue = n - 1;

    if (newValue < 0) {
      return channelIds.length - 1;
    }

    return newValue;
  });
};

const MAX_VOLUME = 15;
const VOLUME_STEP = 1 / MAX_VOLUME;

function decrementVolume() {
  const newVol = get_store_value(volume) - VOLUME_STEP;

  if (newVol < 0) return;

  volume.set(newVol);
}

function incrementVolume() {
  const newVol = get_store_value(volume) + VOLUME_STEP;

  if (newVol > 1) return;

  volume.set(newVol);
}

function toggleMute() {
  const $volume = get_store_value(volume);

  if ($volume === 0) {
    volume.set(prevVolume);
  } else {
    prevVolume = $volume;
    volume.set(0);
  }
}

const toggleContent = () => {
  contentVisible.update((v) => !v);
};

function toggleSpace() {
  tvEl.addEventListener(
    'animationend',
    (e) => {
      raf(() => {
        if (e.animationName === 'go-to-space') {
          return body.setAttribute('space', 'floating');
        }

        if (e.animationName === 'exit-space') {
          return body.removeAttribute('space');
        }
      });
    },
    { once: true },
  );

  raf(() => {
    const nextState =
      body.getAttribute('space') === 'floating' ? 'exiting' : 'entering';

    body.setAttribute('space', nextState);

    if (nextState === 'entering') {
      sendEvent({
        type: 'easter_egg',
        label: 'space',
      });
    }
  });
}

function loadChannelTimestamps() {
  const tsList = JSON.parse(localStorage.getItem('timestamps'));

  if (tsList == null) return;

  tsList.forEach(([id, ts]) => {
    channelMap[id].startTimestamp = ts;
  });
}

function saveChannelTimestamps() {
  localStorage.setItem(
    'timestamps',
    JSON.stringify(
      Object.entries(channelMap).map(([id, info]) => {
        return [id, info.startTimestamp];
      }),
    ),
  );
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  }
}

function lookForChannelButtons() {
  const channelButtons = document.querySelectorAll('.js-channel-trigger');

  channelButtons.forEach((button) => {
    if (button._channelButton) return;

    button._channelButton = true;

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.target.blur();

      const channel = Number(e.target.dataset.channel);

      if (!Number.isNaN(channel)) {
        currentChannel.update((current) => {
          if (channel === current) return 0;

          return channel;
        });
      }
    });
  });
}

window.addEventListener(
  'visibilitychange',
  () => {
    if (document.visibilityState === 'hidden') {
      saveChannelTimestamps();
    }
  },
  false,
);

window.addEventListener('contentChange', lookForChannelButtons);

loadChannelTimestamps();
lookForChannelButtons();

/* src/assets/scripts/components/Volume.svelte generated by Svelte v3.37.0 */

function get_each_context$1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[6] = list[i];
	child_ctx[8] = i;
	return child_ctx;
}

// (38:0) {#if !hidden}
function create_if_block$1(ctx) {
	let div1;
	let t;
	let div0;
	let each_value = { length: 15 };
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
	}

	return {
		c() {
			div1 = element("div");
			t = text("VOLUME\n    ");
			div0 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			attr(div0, "class", "track svelte-1jjpu9w");
			attr(div1, "class", "volume glitchy-text svelte-1jjpu9w");
		},
		m(target, anchor) {
			insert(target, div1, anchor);
			append(div1, t);
			append(div1, div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div0, null);
			}
		},
		p(ctx, dirty) {
			if (dirty & /*transformed*/ 2) {
				each_value = { length: 15 };
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$1(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block$1(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(div0, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		d(detaching) {
			if (detaching) detach(div1);
			destroy_each(each_blocks, detaching);
		}
	};
}

// (42:6) {#each { length: 15 } as _, i}
function create_each_block$1(ctx) {
	let div;
	let t_value = (/*i*/ ctx[8] <= /*transformed*/ ctx[1] ? "|" : "-") + "";
	let t;

	return {
		c() {
			div = element("div");
			t = text(t_value);
			attr(div, "class", "step");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, t);
		},
		p(ctx, dirty) {
			if (dirty & /*transformed*/ 2 && t_value !== (t_value = (/*i*/ ctx[8] <= /*transformed*/ ctx[1] ? "|" : "-") + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(div);
		}
	};
}

function create_fragment$6(ctx) {
	let if_block_anchor;
	let if_block = !/*hidden*/ ctx[0] && create_if_block$1(ctx);

	return {
		c() {
			if (if_block) if_block.c();
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert(target, if_block_anchor, anchor);
		},
		p(ctx, [dirty]) {
			if (!/*hidden*/ ctx[0]) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block$1(ctx);
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (if_block) if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

function instance$5($$self, $$props, $$invalidate) {
	let transformed;
	let $volume;
	component_subscribe($$self, volume, $$value => $$invalidate(2, $volume = $$value));
	let hidden = true;
	let timer = null;
	let firstRender = true;

	function show() {
		if (firstRender) {
			return firstRender = false;
		}

		$$invalidate(0, hidden = false);
		clearTimeout(timer);
		timer = timeout(() => $$invalidate(0, hidden = true), 2000);
	}

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*$volume*/ 4) {
			$$invalidate(1, transformed = Math.floor(15 * $volume));
		}

		if ($$self.$$.dirty & /*$volume*/ 4) {
			show();
		}
	};

	return [hidden, transformed, $volume];
}

class Volume extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$5, create_fragment$6, safe_not_equal, {});
	}
}

/* src/assets/scripts/components/Webcam.svelte generated by Svelte v3.37.0 */

function create_fragment$5(ctx) {
	let div3;
	let video_1;
	let t0;
	let div2;
	let div0;
	let t2;
	let div1;
	let t3;

	return {
		c() {
			div3 = element("div");
			video_1 = element("video");
			t0 = space();
			div2 = element("div");
			div0 = element("div");
			div0.innerHTML = `REC <span class="svelte-8udoa4"></span>`;
			t2 = space();
			div1 = element("div");
			t3 = text(/*formattedTime*/ ctx[2]);
			attr(video_1, "class", "tv-video svelte-8udoa4");
			attr(video_1, "channel", "camera");
			video_1.autoplay = true;
			attr(div0, "class", "rec svelte-8udoa4");
			attr(div1, "class", "counter");
			attr(div2, "class", "rec-wrapper big-text glitchy-text svelte-8udoa4");
			toggle_class(div3, "visually-hidden", !/*isReady*/ ctx[0] || /*$loadingChannel*/ ctx[3] === LOADING_STATE.Loading);
		},
		m(target, anchor) {
			insert(target, div3, anchor);
			append(div3, video_1);
			/*video_1_binding*/ ctx[5](video_1);
			append(div3, t0);
			append(div3, div2);
			append(div2, div0);
			append(div2, t2);
			append(div2, div1);
			append(div1, t3);
		},
		p(ctx, [dirty]) {
			if (dirty & /*formattedTime*/ 4) set_data(t3, /*formattedTime*/ ctx[2]);

			if (dirty & /*isReady, $loadingChannel, LOADING_STATE*/ 9) {
				toggle_class(div3, "visually-hidden", !/*isReady*/ ctx[0] || /*$loadingChannel*/ ctx[3] === LOADING_STATE.Loading);
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div3);
			/*video_1_binding*/ ctx[5](null);
		}
	};
}

function padNumber(n) {
	return n < 10 ? `0${n}` : n;
}

function instance$4($$self, $$props, $$invalidate) {
	let $loadingChannel;
	component_subscribe($$self, loadingChannel, $$value => $$invalidate(3, $loadingChannel = $$value));
	const dispatch = createEventDispatcher();
	let isReady = false;
	let stream;
	let video;
	let startTime;
	let elapsedTime;
	let formattedTime;
	let counterRequest;

	async function initStream() {
		stream = await window.navigator.mediaDevices.getUserMedia({
			video: {
				width: { exact: 256 },
				height: { exact: 144 }
			}
		}).catch(() => null);

		if (stream == null || video == null) {
			return;
		}

		$$invalidate(1, video.srcObject = stream, video);

		video.addEventListener(
			"playing",
			() => {
				dispatch("ready", true);
				$$invalidate(0, isReady = true);
				initCounter();
				body.setAttribute("camera", "");
			},
			{ once: true }
		);
	}

	function initCounter() {
		counterRequest = raf(function loop(ts) {
			if (startTime == null) {
				startTime = ts;
			}

			$$invalidate(4, elapsedTime = ts - startTime);
			counterRequest = raf(loop);
		});
	}

	onMount(() => {
		initStream();

		return () => {
			body.removeAttribute("camera");
			cancelAnimationFrame(counterRequest);

			if (stream) {
				stream.getTracks().forEach(track => track.stop());
			}
		};
	});

	function video_1_binding($$value) {
		binding_callbacks[$$value ? "unshift" : "push"](() => {
			video = $$value;
			$$invalidate(1, video);
		});
	}

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*elapsedTime*/ 16) {
			{
				const milliseconds = parseInt(elapsedTime % 1000 / 100);
				const seconds = padNumber(Math.floor(elapsedTime / 1000 % 60));
				const minutes = padNumber(Math.floor(elapsedTime / (1000 * 60) % 60));
				const hours = padNumber(Math.floor(elapsedTime / (1000 * 60 * 60) % 24));
				$$invalidate(2, formattedTime = `${hours}:${minutes}:${seconds}.${milliseconds}`);
			}
		}
	};

	return [isReady, video, formattedTime, $loadingChannel, elapsedTime, video_1_binding];
}

class Webcam extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$4, create_fragment$5, safe_not_equal, {});
	}
}

/* src/assets/scripts/components/Video.svelte generated by Svelte v3.37.0 */

function create_fragment$4(ctx) {
	let video_1;
	let source0;
	let source0_src_value;
	let source1;
	let source1_src_value;
	let video_1_channel_value;
	let mounted;
	let dispose;

	return {
		c() {
			video_1 = element("video");
			source0 = element("source");
			source1 = element("source");
			if (source0.src !== (source0_src_value = "/assets/videos/channel-" + /*$currentChannelInfo*/ ctx[4].displayName + ".webm")) attr(source0, "src", source0_src_value);
			attr(source0, "type", "video/webm");
			if (source1.src !== (source1_src_value = "/assets/videos/channel-" + /*$currentChannelInfo*/ ctx[4].displayName + ".mp4")) attr(source1, "src", source1_src_value);
			attr(source1, "type", "video/mp4");
			attr(video_1, "class", "tv-video");
			attr(video_1, "channel", video_1_channel_value = /*$currentChannelInfo*/ ctx[4].number);
			video_1.playsInline = true;
			video_1.loop = true;
			if (/*duration*/ ctx[2] === void 0) add_render_callback(() => /*video_1_durationchange_handler*/ ctx[10].call(video_1));
			toggle_class(video_1, "visually-hidden", !/*isReady*/ ctx[1] || /*$loadingChannel*/ ctx[3] === LOADING_STATE.Loading);
		},
		m(target, anchor) {
			insert(target, video_1, anchor);
			append(video_1, source0);
			append(video_1, source1);
			/*video_1_binding*/ ctx[8](video_1);

			if (!isNaN(/*$volume*/ ctx[5])) {
				video_1.volume = /*$volume*/ ctx[5];
			}

			if (!mounted) {
				dispose = [
					listen(video_1, "volumechange", /*video_1_volumechange_handler*/ ctx[9]),
					listen(video_1, "durationchange", /*video_1_durationchange_handler*/ ctx[10]),
					listen(video_1, "canplay", /*handleCanPlay*/ ctx[6])
				];

				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (dirty & /*$currentChannelInfo*/ 16 && source0.src !== (source0_src_value = "/assets/videos/channel-" + /*$currentChannelInfo*/ ctx[4].displayName + ".webm")) {
				attr(source0, "src", source0_src_value);
			}

			if (dirty & /*$currentChannelInfo*/ 16 && source1.src !== (source1_src_value = "/assets/videos/channel-" + /*$currentChannelInfo*/ ctx[4].displayName + ".mp4")) {
				attr(source1, "src", source1_src_value);
			}

			if (dirty & /*$currentChannelInfo*/ 16 && video_1_channel_value !== (video_1_channel_value = /*$currentChannelInfo*/ ctx[4].number)) {
				attr(video_1, "channel", video_1_channel_value);
			}

			if (dirty & /*$volume*/ 32 && !isNaN(/*$volume*/ ctx[5])) {
				video_1.volume = /*$volume*/ ctx[5];
			}

			if (dirty & /*isReady, $loadingChannel, LOADING_STATE*/ 10) {
				toggle_class(video_1, "visually-hidden", !/*isReady*/ ctx[1] || /*$loadingChannel*/ ctx[3] === LOADING_STATE.Loading);
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(video_1);
			/*video_1_binding*/ ctx[8](null);
			mounted = false;
			run_all(dispose);
		}
	};
}

function instance$3($$self, $$props, $$invalidate) {
	let $loadingChannel;
	let $currentChannelInfo;
	let $currentChannel;
	let $volume;
	component_subscribe($$self, loadingChannel, $$value => $$invalidate(3, $loadingChannel = $$value));
	component_subscribe($$self, currentChannelInfo, $$value => $$invalidate(4, $currentChannelInfo = $$value));
	component_subscribe($$self, currentChannel, $$value => $$invalidate(7, $currentChannel = $$value));
	component_subscribe($$self, volume, $$value => $$invalidate(5, $volume = $$value));
	const dispatch = createEventDispatcher();
	let video;
	let isReady = false;
	let duration;

	function loadVideo() {
		if (!video) return;
		$$invalidate(1, isReady = false);
		video.load();
	}

	function updatePlayState() {
		if (!video) return;

		if (isReady && $loadingChannel === LOADING_STATE.Done) {
			return video.play();
		}

		video.pause();
	}

	function updateCurrentTime() {
		const { number, startTimestamp } = $currentChannelInfo;
		const now = Date.now() / 1000;

		if (startTimestamp != null) {
			let diff = now - startTimestamp;
			let currentTime;

			if (diff < duration) {
				currentTime = diff;
			} else {
				currentTime = diff % duration;
				updateChannelInfo(number, { startTimestamp: now - currentTime });
			}

			$$invalidate(0, video.currentTime = currentTime, video);
		} else {
			updateChannelInfo(number, { startTimestamp: now });
		}
	}

	function handleCanPlay() {
		if (video.readyState < 2) return;
		dispatch("ready", true);
		$$invalidate(1, isReady = true);
	}

	function video_1_binding($$value) {
		binding_callbacks[$$value ? "unshift" : "push"](() => {
			video = $$value;
			$$invalidate(0, video);
		});
	}

	function video_1_volumechange_handler() {
		$volume = this.volume;
		volume.set($volume);
	}

	function video_1_durationchange_handler() {
		duration = this.duration;
		$$invalidate(2, duration);
	}

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*$currentChannel, video*/ 129) {
			loadVideo();
		}

		if ($$self.$$.dirty & /*isReady, $loadingChannel*/ 10) {
			updatePlayState();
		}

		if ($$self.$$.dirty & /*duration*/ 4) {
			duration && updateCurrentTime();
		}
	};

	return [
		video,
		isReady,
		duration,
		$loadingChannel,
		$currentChannelInfo,
		$volume,
		handleCanPlay,
		$currentChannel,
		video_1_binding,
		video_1_volumechange_handler,
		video_1_durationchange_handler
	];
}

class Video extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$3, create_fragment$4, safe_not_equal, {});
	}
}

function noise() {
  if (!window.AudioContext) return;

  try {
    const audioCtx = new window.AudioContext();
    const bufferSize = audioCtx.sampleRate / 3;
    const noiseBuffer = audioCtx.createBuffer(
      1,
      bufferSize,
      audioCtx.sampleRate,
    );

    const gainNode = audioCtx.createGain();

    gainNode.gain.setValueAtTime(0.008, audioCtx.currentTime);
    gainNode.connect(audioCtx.destination);

    for (
      let i = 0, noiseBufferOutput = noiseBuffer.getChannelData(0);
      i < bufferSize;
      i++
    ) {
      noiseBufferOutput[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = audioCtx.createBufferSource();

    whiteNoise.buffer = noiseBuffer;
    whiteNoise.connect(gainNode);
    whiteNoise.loop = true;
    whiteNoise.start(0);
    whiteNoise.onended = () => {
      whiteNoise.disconnect();
      gainNode.disconnect();
      audioCtx.close();
    };

    return whiteNoise;
  } catch (e) {
    {
      console.error(e);
    }
  }
}

let noiseInstance = null;

function startNoise() {
  if (noiseInstance != null) return;
  noiseInstance = noise();
}

function stopNoise() {
  if (noiseInstance) {
    noiseInstance.stop();
    noiseInstance = null;
  }
}

/* src/assets/scripts/components/Screen.svelte generated by Svelte v3.37.0 */

function create_if_block_1(ctx) {
	let video;
	let current;
	video = new Video({});
	video.$on("ready", /*handleChannelReady*/ ctx[1]);

	return {
		c() {
			create_component(video.$$.fragment);
		},
		m(target, anchor) {
			mount_component(video, target, anchor);
			current = true;
		},
		p: noop,
		i(local) {
			if (current) return;
			transition_in(video.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(video.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			destroy_component(video, detaching);
		}
	};
}

// (104:2) {#if $currentChannelInfo.type === 'webcam'}
function create_if_block(ctx) {
	let webcam;
	let current;
	webcam = new Webcam({});
	webcam.$on("ready", /*handleChannelReady*/ ctx[1]);

	return {
		c() {
			create_component(webcam.$$.fragment);
		},
		m(target, anchor) {
			mount_component(webcam, target, anchor);
			current = true;
		},
		p: noop,
		i(local) {
			if (current) return;
			transition_in(webcam.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(webcam.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			destroy_component(webcam, detaching);
		}
	};
}

function create_fragment$3(ctx) {
	let div;
	let current_block_type_index;
	let if_block;
	let t;
	let volume;
	let current;
	const if_block_creators = [create_if_block, create_if_block_1];
	const if_blocks = [];

	function select_block_type(ctx, dirty) {
		if (/*$currentChannelInfo*/ ctx[0].type === "webcam") return 0;
		if (/*$currentChannelInfo*/ ctx[0].type === "video") return 1;
		return -1;
	}

	if (~(current_block_type_index = select_block_type(ctx))) {
		if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
	}

	volume = new Volume({});

	return {
		c() {
			div = element("div");
			if (if_block) if_block.c();
			t = space();
			create_component(volume.$$.fragment);
			attr(div, "class", "tv-videos svelte-1dsge9w");
		},
		m(target, anchor) {
			insert(target, div, anchor);

			if (~current_block_type_index) {
				if_blocks[current_block_type_index].m(div, null);
			}

			insert(target, t, anchor);
			mount_component(volume, target, anchor);
			current = true;
		},
		p(ctx, [dirty]) {
			let previous_block_index = current_block_type_index;
			current_block_type_index = select_block_type(ctx);

			if (current_block_type_index === previous_block_index) {
				if (~current_block_type_index) {
					if_blocks[current_block_type_index].p(ctx, dirty);
				}
			} else {
				if (if_block) {
					group_outros();

					transition_out(if_blocks[previous_block_index], 1, 1, () => {
						if_blocks[previous_block_index] = null;
					});

					check_outros();
				}

				if (~current_block_type_index) {
					if_block = if_blocks[current_block_type_index];

					if (!if_block) {
						if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
						if_block.c();
					} else {
						if_block.p(ctx, dirty);
					}

					transition_in(if_block, 1);
					if_block.m(div, null);
				} else {
					if_block = null;
				}
			}
		},
		i(local) {
			if (current) return;
			transition_in(if_block);
			transition_in(volume.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(if_block);
			transition_out(volume.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);

			if (~current_block_type_index) {
				if_blocks[current_block_type_index].d();
			}

			if (detaching) detach(t);
			destroy_component(volume, detaching);
		}
	};
}

const MIN_CHANNEL_LOADING_TIME = 400;

function instance$2($$self, $$props, $$invalidate) {
	let $loadingChannel;
	let $currentChannelInfo;
	let $currentChannel;
	let $contentVisible;
	let $loadingPage;
	component_subscribe($$self, loadingChannel, $$value => $$invalidate(2, $loadingChannel = $$value));
	component_subscribe($$self, currentChannelInfo, $$value => $$invalidate(0, $currentChannelInfo = $$value));
	component_subscribe($$self, currentChannel, $$value => $$invalidate(3, $currentChannel = $$value));
	component_subscribe($$self, contentVisible, $$value => $$invalidate(4, $contentVisible = $$value));
	component_subscribe($$self, loadingPage, $$value => $$invalidate(5, $loadingPage = $$value));
	let mounted = false;
	let channelLoadTimestamp;

	function startLoadingChannelAnimation() {
		stopLoadingChannelAnimation();
		body.classList.add("loading-channel");
		channelLoadTimestamp = Date.now();
	}

	function stopLoadingChannelAnimation() {
		body.classList.remove("loading-channel");
	}

	function handleChannelReady() {
		raf(() => {
			const diff = Date.now() - channelLoadTimestamp;

			if (diff <= MIN_CHANNEL_LOADING_TIME) {
				timeout(
					() => {
						set_store_value(loadingChannel, $loadingChannel = LOADING_STATE.Done, $loadingChannel);
					},
					MIN_CHANNEL_LOADING_TIME - diff
				);
			} else {
				set_store_value(loadingChannel, $loadingChannel = LOADING_STATE.Done, $loadingChannel);
			}
		});
	}

	function handleChannelChange(channelInfo) {
		// prevent firing before mounting
		if (!mounted) return;

		raf(() => {
			set_store_value(loadingChannel, $loadingChannel = LOADING_STATE.Loading, $loadingChannel);

			// can't wait for something that's not a video/webcam
			if (channelInfo.type == "unknown") {
				handleChannelReady();
			}
		});

		sendEvent({
			type: "easter_egg",
			label: "channel_switch",
			value: channelInfo.displayName
		});
	}

	onMount(() => {
		mounted = true;
	});

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*$loadingChannel*/ 4) {
			$loadingChannel === LOADING_STATE.Loading
			? startLoadingChannelAnimation()
			: stopLoadingChannelAnimation();
		}

		if ($$self.$$.dirty & /*$currentChannelInfo*/ 1) {
			handleChannelChange($currentChannelInfo);
		}

		if ($$self.$$.dirty & /*$currentChannel*/ 8) {
			body.setAttribute("channel", `${$currentChannel}`);
		}

		if ($$self.$$.dirty & /*$contentVisible*/ 16) {
			body.classList.toggle("hide-content", !$contentVisible);
		}

		if ($$self.$$.dirty & /*$loadingPage*/ 32) {
			{
				body.classList.toggle("loading-page", $loadingPage === LOADING_STATE.Loading);
			}
		}

		if ($$self.$$.dirty & /*$loadingPage, $loadingChannel*/ 36) {
			{
				if ($loadingPage === LOADING_STATE.Loading || $loadingChannel === LOADING_STATE.Loading) {
					startNoise();
				} else {
					stopNoise();
				}
			}
		}
	};

	return [
		$currentChannelInfo,
		handleChannelReady,
		$loadingChannel,
		$currentChannel,
		$contentVisible,
		$loadingPage
	];
}

class Screen extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$2, create_fragment$3, safe_not_equal, {});
	}
}

/* src/assets/scripts/components/Remote.svelte generated by Svelte v3.37.0 */

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[3] = list[i];
	child_ctx[5] = i;
	return child_ctx;
}

// (288:12) {#each { length: 9 } as _, i}
function create_each_block(ctx) {
	let div;
	let button;
	let t_value = /*i*/ ctx[5] + 1 + "";
	let t;
	let mounted;
	let dispose;

	function click_handler_1() {
		return /*click_handler_1*/ ctx[1](/*i*/ ctx[5]);
	}

	return {
		c() {
			div = element("div");
			button = element("button");
			t = text(t_value);
			attr(button, "class", "svelte-f1hlfd");
			attr(div, "class", "control number svelte-f1hlfd");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, button);
			append(button, t);

			if (!mounted) {
				dispose = listen(button, "click", click_handler_1);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
		},
		d(detaching) {
			if (detaching) detach(div);
			mounted = false;
			dispose();
		}
	};
}

function create_fragment$2(ctx) {
	let div14;
	let div13;
	let div12;
	let div11;
	let div9;
	let div0;
	let button0;
	let t1;
	let span0;
	let t3;
	let div1;
	let button1;
	let t5;
	let div2;
	let button2;
	let t7;
	let span1;
	let t9;
	let div3;
	let button3;
	let t11;
	let span2;
	let t13;
	let div4;
	let button4;
	let t15;
	let div5;
	let button5;
	let t17;
	let span3;
	let t19;
	let div8;
	let t20;
	let div6;
	let button6;
	let t22;
	let div7;
	let button7;
	let t24;
	let div10;
	let mounted;
	let dispose;
	let each_value = { length: 9 };
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	return {
		c() {
			div14 = element("div");
			div13 = element("div");
			div12 = element("div");
			div11 = element("div");
			div9 = element("div");
			div0 = element("div");
			button0 = element("button");
			button0.textContent = "REMOTE\n              OFF";
			t1 = space();
			span0 = element("span");
			span0.textContent = "SPACE OFF";
			t3 = space();
			div1 = element("div");
			button1 = element("button");
			button1.textContent = "▲";
			t5 = space();
			div2 = element("div");
			button2 = element("button");
			button2.textContent = "▼";
			t7 = space();
			span1 = element("span");
			span1.textContent = "VOLUME";
			t9 = space();
			div3 = element("div");
			button3 = element("button");
			button3.textContent = "MUTE";
			t11 = space();
			span2 = element("span");
			span2.textContent = "MUTE";
			t13 = space();
			div4 = element("div");
			button4 = element("button");
			button4.textContent = "▲";
			t15 = space();
			div5 = element("div");
			button5 = element("button");
			button5.textContent = "▼";
			t17 = space();
			span3 = element("span");
			span3.textContent = "CHANNEL";
			t19 = space();
			div8 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t20 = space();
			div6 = element("div");
			button6 = element("button");
			button6.textContent = "0";
			t22 = space();
			div7 = element("div");
			button7 = element("button");
			button7.textContent = "SHOW/HIDE";
			t24 = space();
			div10 = element("div");

			div10.innerHTML = `<img loading="lazy" src="/assets/images/kiwivision.svg" alt="kiwivision" width="103" height="10" class="svelte-f1hlfd"/> 
          <br/> 
          <span>COMPUTER SPACE COMMAND</span>`;

			attr(button0, "class", "hide-text svelte-f1hlfd");
			attr(span0, "class", "svelte-f1hlfd");
			attr(div0, "class", "control onoff svelte-f1hlfd");
			attr(button1, "class", "svelte-f1hlfd");
			attr(div1, "class", "control vol up svelte-f1hlfd");
			attr(button2, "class", "svelte-f1hlfd");
			attr(span1, "class", "svelte-f1hlfd");
			attr(div2, "class", "control vol down svelte-f1hlfd");
			attr(button3, "class", "hide-text svelte-f1hlfd");
			attr(span2, "class", "svelte-f1hlfd");
			attr(div3, "class", "control mute svelte-f1hlfd");
			attr(button4, "class", "svelte-f1hlfd");
			attr(div4, "class", "control ch up svelte-f1hlfd");
			attr(button5, "class", "svelte-f1hlfd");
			attr(span3, "class", "svelte-f1hlfd");
			attr(div5, "class", "control ch down svelte-f1hlfd");
			attr(button6, "class", "svelte-f1hlfd");
			attr(div6, "class", "control number svelte-f1hlfd");
			attr(button7, "class", "showhide svelte-f1hlfd");
			attr(div7, "class", "control showhide svelte-f1hlfd");
			attr(div8, "class", "numbers svelte-f1hlfd");
			attr(div9, "class", "buttons svelte-f1hlfd");
			attr(div10, "class", "brand svelte-f1hlfd");
			attr(div11, "class", "inner svelte-f1hlfd");
			attr(div12, "class", "remote svelte-f1hlfd");
			attr(div13, "class", "wrapper svelte-f1hlfd");
			attr(div14, "class", "perspective svelte-f1hlfd");
		},
		m(target, anchor) {
			insert(target, div14, anchor);
			append(div14, div13);
			append(div13, div12);
			append(div12, div11);
			append(div11, div9);
			append(div9, div0);
			append(div0, button0);
			append(div0, t1);
			append(div0, span0);
			append(div9, t3);
			append(div9, div1);
			append(div1, button1);
			append(div9, t5);
			append(div9, div2);
			append(div2, button2);
			append(div2, t7);
			append(div2, span1);
			append(div9, t9);
			append(div9, div3);
			append(div3, button3);
			append(div3, t11);
			append(div3, span2);
			append(div9, t13);
			append(div9, div4);
			append(div4, button4);
			append(div9, t15);
			append(div9, div5);
			append(div5, button5);
			append(div5, t17);
			append(div5, span3);
			append(div9, t19);
			append(div9, div8);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div8, null);
			}

			append(div8, t20);
			append(div8, div6);
			append(div6, button6);
			append(div8, t22);
			append(div8, div7);
			append(div7, button7);
			append(div11, t24);
			append(div11, div10);

			if (!mounted) {
				dispose = [
					listen(button0, "click", /*click_handler*/ ctx[0]),
					listen(button1, "click", incrementVolume),
					listen(button2, "click", decrementVolume),
					listen(button3, "click", toggleMute),
					listen(button4, "click", incrementChannel),
					listen(button5, "click", decrementChannel),
					listen(button6, "click", /*click_handler_2*/ ctx[2]),
					listen(button7, "click", toggleContent)
				];

				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (dirty & /*gotoChannel*/ 0) {
				each_value = { length: 9 };
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(div8, t20);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div14);
			destroy_each(each_blocks, detaching);
			mounted = false;
			run_all(dispose);
		}
	};
}

function instance$1($$self) {
	const click_handler = () => toggleSpace();
	const click_handler_1 = i => gotoChannel(i + 1);
	const click_handler_2 = () => gotoChannel(0);
	return [click_handler, click_handler_1, click_handler_2];
}

class Remote extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$1, create_fragment$2, safe_not_equal, {});
	}
}

/* src/assets/scripts/components/HeaderControls.svelte generated by Svelte v3.37.0 */

function create_fragment$1(ctx) {
	let div1;
	let button0;
	let t1;
	let div0;
	let t2;
	let span;
	let t3_value = /*$currentChannelInfo*/ ctx[0].displayName + "";
	let t3;
	let t4;
	let button1;
	let mounted;
	let dispose;

	return {
		c() {
			div1 = element("div");
			button0 = element("button");
			button0.textContent = "◄";
			t1 = space();
			div0 = element("div");
			t2 = text("CHANNEL ");
			span = element("span");
			t3 = text(t3_value);
			t4 = space();
			button1 = element("button");
			button1.textContent = "►";
			attr(button0, "class", "previous cursor-pointer svelte-z82i2n");
			attr(button0, "aria-label", "previous channel");
			attr(div0, "class", "channel");
			attr(button1, "class", "next cursor-pointer svelte-z82i2n");
			attr(button1, "aria-label", "next channel");
			attr(div1, "class", "channel-controller svelte-z82i2n");
		},
		m(target, anchor) {
			insert(target, div1, anchor);
			append(div1, button0);
			append(div1, t1);
			append(div1, div0);
			append(div0, t2);
			append(div0, span);
			append(span, t3);
			append(div1, t4);
			append(div1, button1);

			if (!mounted) {
				dispose = [
					listen(button0, "click", decrementChannel),
					listen(button1, "click", incrementChannel)
				];

				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (dirty & /*$currentChannelInfo*/ 1 && t3_value !== (t3_value = /*$currentChannelInfo*/ ctx[0].displayName + "")) set_data(t3, t3_value);
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div1);
			mounted = false;
			run_all(dispose);
		}
	};
}

function instance($$self, $$props, $$invalidate) {
	let $currentChannelInfo;
	component_subscribe($$self, currentChannelInfo, $$value => $$invalidate(0, $currentChannelInfo = $$value));
	return [$currentChannelInfo];
}

class HeaderControls extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment$1, safe_not_equal, {});
	}
}

/* src/assets/scripts/components/SpaceTrigger.svelte generated by Svelte v3.37.0 */

function create_fragment(ctx) {
	let button;
	let mounted;
	let dispose;

	return {
		c() {
			button = element("button");
			button.textContent = "SPACE MODE";
			attr(button, "class", "cursor-pointer svelte-tq4s7t");
		},
		m(target, anchor) {
			insert(target, button, anchor);

			if (!mounted) {
				dispose = listen(button, "click", toggleSpace);
				mounted = true;
			}
		},
		p: noop,
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(button);
			mounted = false;
			dispose();
		}
	};
}

class SpaceTrigger extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, create_fragment, safe_not_equal, {});
	}
}

var jsLevenshtein = (function()
{
  function _min(d0, d1, d2, bx, ay)
  {
    return d0 < d1 || d2 < d1
        ? d0 > d2
            ? d2 + 1
            : d0 + 1
        : bx === ay
            ? d1
            : d1 + 1;
  }

  return function(a, b)
  {
    if (a === b) {
      return 0;
    }

    if (a.length > b.length) {
      var tmp = a;
      a = b;
      b = tmp;
    }

    var la = a.length;
    var lb = b.length;

    while (la > 0 && (a.charCodeAt(la - 1) === b.charCodeAt(lb - 1))) {
      la--;
      lb--;
    }

    var offset = 0;

    while (offset < la && (a.charCodeAt(offset) === b.charCodeAt(offset))) {
      offset++;
    }

    la -= offset;
    lb -= offset;

    if (la === 0 || lb < 3) {
      return lb;
    }

    var x = 0;
    var y;
    var d0;
    var d1;
    var d2;
    var d3;
    var dd;
    var dy;
    var ay;
    var bx0;
    var bx1;
    var bx2;
    var bx3;

    var vector = [];

    for (y = 0; y < la; y++) {
      vector.push(y + 1);
      vector.push(a.charCodeAt(offset + y));
    }

    var len = vector.length - 1;

    for (; x < lb - 3;) {
      bx0 = b.charCodeAt(offset + (d0 = x));
      bx1 = b.charCodeAt(offset + (d1 = x + 1));
      bx2 = b.charCodeAt(offset + (d2 = x + 2));
      bx3 = b.charCodeAt(offset + (d3 = x + 3));
      dd = (x += 4);
      for (y = 0; y < len; y += 2) {
        dy = vector[y];
        ay = vector[y + 1];
        d0 = _min(dy, d0, d1, bx0, ay);
        d1 = _min(d0, d1, d2, bx1, ay);
        d2 = _min(d1, d2, d3, bx2, ay);
        dd = _min(d2, d3, dd, bx3, ay);
        vector[y] = dd;
        d3 = d2;
        d2 = d1;
        d1 = d0;
        d0 = dy;
      }
    }

    for (; x < lb;) {
      bx0 = b.charCodeAt(offset + (d0 = x));
      dd = ++x;
      for (y = 0; y < len; y += 2) {
        dy = vector[y];
        vector[y] = dd = _min(dy, d0, dd, bx0, vector[y + 1]);
        d0 = dy;
      }
    }

    return dd;
  };
})();

const MIN_LOADING_TIME = 300;

const contentSlotList = Array.from(contentEl.querySelectorAll('[js-slot]'));

const pageCache = new Map();

const initialState = {
  title: document.title,
  slots: getSlotsContent(),
};

let parser;
let currentPathname = location.pathname;

function isHashAnchor(element) {
  return (
    element.tagName === 'A' && element.getAttribute('href').indexOf('#') === 0
  );
}

function isTransitionableAnchor(element) {
  return (
    element.tagName === 'A' &&
    !isHashAnchor(element) &&
    element.target !== '_blank' &&
    element.hostname === hostname &&
    !element.hasAttribute('redirect')
  );
}

function getSlotsContent(container = contentEl) {
  let slotList = contentSlotList;

  if (container !== contentEl) {
    slotList = Array.from(container.querySelectorAll('[js-slot]'));
  }

  const slots = slotList.reduce((acc, el) => {
    const slotName = el.getAttribute('js-slot');

    acc[slotName] = el.innerHTML;

    return acc;
  }, {});

  return slots;
}

function replaceSlotsContent({ slots }) {
  Object.entries(slots).forEach(([slotName, slotHTML]) => {
    const slotEl = contentSlotList.find(
      (el) => el.getAttribute('js-slot') === slotName,
    );

    if (slotEl == null) return;

    slotEl.innerHTML = slotHTML;
  });

  window.dispatchEvent(new CustomEvent('contentChange'));
}

function fetchPage(url, { importance } = {}) {
  url = url.replace(/\/$/, '');

  if (pageCache.has(url)) {
    return Promise.resolve(pageCache.get(url));
  }

  const promise = fetch(url, { importance })
    .then((response) => response.text())
    .then((html) => {
      if (parser == null) {
        parser = new DOMParser();
      }

      const doc = parser.parseFromString(html, 'text/html');
      const newContent = doc.querySelector('.js-content');

      const cacheObj = {
        title: doc.title,
        slots: getSlotsContent(newContent),
      };

      pageCache.set(url, cacheObj);

      return cacheObj;
    });

  pageCache.set(url, promise);

  return promise;
}

async function gotoPage(url) {
  if (url.indexOf('#') === 0) return;
  if (url.indexOf('http') !== 0) {
    url = `${window.location.origin}${url}`;
  }

  loadingPage.set(LOADING_STATE.Loading);

  // min loading time of 200ms
  const [{ title, slots }] = await Promise.all([
    fetchPage(url),
    waitFor(MIN_LOADING_TIME),
  ]);

  loadingPage.set(LOADING_STATE.Done);

  raf(() => {
    replaceSlotsContent({ title, slots });

    document.title = title;
    contentEl.scrollTop = 0;

    window.history.pushState({ title, slots }, title, url);
    currentPathname = location.pathname;
  });
}

function updateContentScrollPosition() {
  raf(() => {
    const target = contentEl.querySelector(':target');

    if (target) {
      contentEl.scrollTop = Math.max(target.offsetTop - 24, 0);
    } else {
      contentEl.scrollTop = 0;
    }
  });
}

function initLinks() {
  window.addEventListener('popstate', async (e) => {
    let { state } = e;

    // same pathname, possibily means hash changed
    // prevent hash links from transitioning
    if (location.pathname === currentPathname) {
      e.preventDefault();
      updateContentScrollPosition();

      return;
    }

    currentPathname = location.pathname;

    if (state == null) {
      state = initialState;
    }

    loadingPage.set(LOADING_STATE.Loading);

    await waitFor(MIN_LOADING_TIME);

    loadingPage.set(LOADING_STATE.Done);

    raf(() => {
      replaceSlotsContent(state);
      document.title = state.title;
      updateContentScrollPosition();
    });
  });

  body.addEventListener('mousemove', (e) => {
    if (!isTransitionableAnchor(e.target)) return;
    if (pageCache.has(e.target.href)) return;

    fetchPage(e.target.href, { importante: 'low' });
  });

  body.addEventListener('click', (e) => {
    if (isHashAnchor(e.target)) {
      e.preventDefault();
      location.hash = e.target.getAttribute('href');

      return updateContentScrollPosition();
    }

    if (!isTransitionableAnchor(e.target)) return;

    e.preventDefault();
    gotoPage(e.target.href);
  });
}

let pages;
let textNav;

function getClosestPageMatch(text) {
  const { page } = pages.reduce(
    (acc, p) => {
      const { aliases } = p;

      aliases.forEach((alias) => {
        const weight =
          alias.startsWith(text) || text.startsWith(alias) ? -4 : 1;

        const diff = Math.max(0, jsLevenshtein(alias, text) + weight);

        if (diff < acc.diff) {
          acc = { diff, page: p };
        }
      });

      return acc;
    },
    {
      page: pages[0],
      diff: 100,
    },
  );

  return page;
}

function getCaretPositionWithin(element) {
  let caretOffset = 0;
  const sel = window.getSelection();

  if (sel.rangeCount > 0) {
    const range = window.getSelection().getRangeAt(0);
    const preCaretRange = range.cloneRange();

    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    caretOffset = preCaretRange.toString().length;
  }

  return caretOffset;
}

function updateCaret() {
  if (textNav == null) return;

  const pos = getCaretPositionWithin(textNav);

  textNav.style.setProperty('--caret-position', pos);
}

function changePage() {
  const page = getClosestPageMatch(textNav.textContent.trim());

  if (page.external) {
    window.open(page.url, '_blank');

    return;
  }

  gotoPage(page.url);
}

function fetchPagesData() {
  fetch('/assets/pages.json')
    .then((r) => r.json())
    .then((data) => {
      pages = data;
    })
    .catch(() => {
      if (fetchPagesData.retries++ < 3) {
        fetchPagesData();
      } else {
        console.warn('Something went wrong :(');
      }
    });
}

fetchPagesData.retries = 0;

const debouncedUpdateCaret = raf.bind(null, updateCaret);

const handleClick = debouncedUpdateCaret;

function handleBlur() {
  if (textNav.textContent === '') {
    textNav.textContent = textNav.getAttribute('data-original-text');
  }
}

function handleFocus() {
  debouncedUpdateCaret();

  if (pages == null) {
    fetchPagesData();
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    changePage();
  }

  if (e.key === ' ') {
    e.preventDefault();
  }

  debouncedUpdateCaret();
}

function seekAndBindElement() {
  textNav = document.querySelector('.js-text-nav');

  if (!textNav) {
    return;
  }

  // Garbace collection takes care of removing these listeners when the element is destroyed
  textNav.addEventListener('click', handleClick);
  textNav.addEventListener('blur', handleBlur);
  textNav.addEventListener('focus', handleFocus);
  textNav.addEventListener('keydown', handleKeydown);

  textNav.textContent = textNav.textContent.trim();
}

function initTextNav() {
  seekAndBindElement();
  window.addEventListener('contentChange', seekAndBindElement);
}

function isValidHotkey(e) {
  const activeEl = document.activeElement;

  return (
    activeEl === body ||
    activeEl == null ||
    ((activeEl.tagName === 'BUTTON' || activeEl.tagName === 'A') &&
      e.key !== 'Enter' &&
      e.key !== ' ')
  );
}

function handleHotkey(e) {
  if (!isValidHotkey(e)) return;
  if (e.key === 'r') return toggleSpace();
  if (e.key === '+' || e.key === '=') return incrementChannel();
  if (e.key === '-') return decrementChannel();
  if (e.key === 'h') return toggleContent();
  if (e.key === 'f') return toggleFullscreen();

  const channelNumber = Number(e.key);

  // ignore non-number keys
  if (Number.isNaN(channelNumber)) {
    return;
  }

  // toggle between a X channel and channel 0
  if (channelNumber === get_store_value(currentChannel)) {
    gotoChannel(0);
  } else {
    gotoChannel(channelNumber);
  }
}

function initHotkeys() {
  window.addEventListener('keyup', handleHotkey);
}

const bootstrap = () => {
  raf(() => {
    initTextNav();
    initHotkeys();
    initLinks();

    new Screen({ target: screenEl });

    new Remote({ target: document.querySelector('.js-remote') });

    new HeaderControls({
      target: document.querySelector('.js-header-controls'),
    });

    new SpaceTrigger({
      target: document.querySelector('.js-space-trigger'),
    });
  });
};

if (document.readyState !== 'interactive') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

