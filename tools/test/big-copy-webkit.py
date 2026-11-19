# The WebKit part of npm run test:big-copy (big-copy.mjs): its page in WebKitGTK, the engine Safari is built on, in a
# window nobody sees. WebKit opens a file list only from a person's own key or click, so the Add button gets a key press
# as a person's, and the file list is answered with the disc. It presses Play, steps frames with the proof tools'
# stepping, and prints each frame's middle colour, then the version line, a line of JSON each.
#
#   python3 big-copy-webkit.py <address> <disc> <frames> <1 to wait for the version, or 0>
import json, sys
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
gi.require_version('Gdk', '3.0')
from gi.repository import Gtk, Gdk, WebKit2, GLib

url, path, frames, wait_version = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == '1'
win = Gtk.OffscreenWindow()
win.set_default_size(900, 700)
view = WebKit2.WebView()
settings = view.get_settings()
settings.set_enable_developer_extras(True)
win.add(view)
win.show_all()
out = lambda **kw: print(json.dumps(kw), flush=True)

def chooser(_view, request):
    request.select_files([path])
    out(event='chose', path=path)
    return True
view.connect('run-file-chooser', chooser)

def js(code, then):
    def done(v, result):
        try:
            value = v.call_async_javascript_function_finish(result)
            then(json.loads(value.to_json(0)) if value and not value.is_undefined() else None)
        except Exception as error:
            out(event='error', message=str(error))
            Gtk.main_quit()
    view.call_async_javascript_function(code, -1, None, None, None, None, done)

def key(keyval):
    for kind in (Gdk.EventType.KEY_PRESS, Gdk.EventType.KEY_RELEASE):
        ev = Gdk.Event.new(kind)
        ev.key.window = view.get_window()
        ev.key.keyval = keyval
        ev.key.hardware_keycode = 36 if keyval == Gdk.KEY_Return else 65
        ev.key.send_event = True
        ev.key.time = Gtk.get_current_event_time()
        seat = Gdk.Display.get_default().get_default_seat()
        ev.set_device(seat.get_keyboard())
        view.event(ev)

def poll(code, then, tries=600):
    def tick():
        def got(value):
            if value:
                then(value)
            elif tick.left > 0:
                tick.left -= 1
                GLib.timeout_add(200, tick)
            else:
                out(event='error', message=f'timed out: {code}')
                Gtk.main_quit()
        js(f'return {code};', got)
        return False
    tick.left = tries
    tick()

shown = []
def step(n):
    if n == frames:
        if wait_version:
            poll("/tested version|untested version/.test(document.querySelector('.rom-detail')?.textContent ?? '') && document.querySelector('.rom-detail').textContent", lambda line: (out(event='version', line=line), Gtk.main_quit()), 1500)
        else:
            Gtk.main_quit()
        return
    js("const p = await dreamportsProof.step({ held: [] }); const at = (p.width * (p.height >> 1) + (p.width >> 1)) * 4; return [...p.data.subarray(at, at + 3)].map(x => x.toString(16).padStart(2, '0')).join('');",
       lambda colour: (out(event='frame', n=n, colour=colour), step(n + 1)))

def started(_):
    js('await dreamportsProof.ready; return true;', lambda _: step(0))

def ready(_):
    js("document.querySelector('.play').click(); return true;", started)

def picked(_):
    js("const keep = document.querySelector('.remember input'); if (keep) keep.checked = false; document.querySelector('.rom-add').focus(); return true;", lambda _: (GLib.timeout_add(300, lambda: (key(Gdk.KEY_Return), False)[1]), poll("!document.querySelector('.play').disabled", ready)))

def loaded(_view, event):
    if event == WebKit2.LoadEvent.FINISHED:
        poll("document.querySelector('.setup')?.dataset.restored === 'true' && !!document.querySelector('.rom input[type=file]')", picked)
view.connect('load-changed', loaded)
view.load_uri(url)
GLib.timeout_add_seconds(400, lambda: (out(event='error', message='gave up'), Gtk.main_quit()))
Gtk.main()
