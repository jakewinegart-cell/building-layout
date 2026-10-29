"""v5: suites written for the 32×24 sample plan skip the 'Size of your build' pop-up (window.__SKIP_SIZE_POPUP)."""
SCRIPT = 'window.__SKIP_SIZE_POPUP = true;'
def patch(b):
    np, nc = b.new_page, b.new_context
    def new_context(*a, **k):
        c = nc(*a, **k); c.add_init_script(SCRIPT); return c
    def new_page(*a, **k):
        pg = np(*a, **k); pg.context.add_init_script(SCRIPT); return pg
    b.new_page, b.new_context = new_page, new_context
    return b
