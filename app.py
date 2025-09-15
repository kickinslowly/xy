from flask import Flask, render_template
import os

app = Flask(__name__)


@app.route('/')
def index():
    # Gather available images from the static directory
    static_dir = os.path.join(app.root_path, 'static')
    exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}
    try:
        images = [name for name in os.listdir(static_dir) if os.path.splitext(name)[1].lower() in exts]
    except Exception:
        images = []
    return render_template('index.html', available_images=images)


@app.route('/line-mode')
def line_mode():
    return render_template('line_mode.html')

if __name__ == '__main__':
    app.run(debug=True)
