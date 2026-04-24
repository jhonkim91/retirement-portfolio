import os

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from models import db
from routes import api
from scheduler import start_scheduler

load_dotenv()

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///retirement.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'change-this-secret-key')

CORS(app, resources={
    r'/api/*': {
        'origins': '*',
        'methods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        'allow_headers': ['Content-Type', 'Authorization']
    }
})
db.init_app(app)
jwt = JWTManager(app)
app.register_blueprint(api)


@app.errorhandler(404)
def not_found(error):
    return {'error': '요청한 리소스를 찾을 수 없습니다.'}, 404


@app.errorhandler(500)
def server_error(error):
    return {'error': '서버 오류가 발생했습니다.'}, 500


with app.app_context():
    db.create_all()

scheduler = start_scheduler(app)

if __name__ == '__main__':
    print('퇴직연금 관리대장 서버가 시작되었습니다.')
    print('PC: http://localhost:5000')
    print('휴대폰: 같은 와이파이에서 http://PC_IP:5000')
    app.run(debug=False, host='0.0.0.0', port=5000, use_reloader=False)
