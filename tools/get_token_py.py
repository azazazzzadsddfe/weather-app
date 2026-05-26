"""
小米云 token 提取工具 (使用 micloud 库)
运行: python tools/get_token_py.py
"""
import json, os, sys
from getpass import getpass

def main():
    print("=" * 50)
    print("  米家设备 Token 提取 (Python)")
    print("=" * 50)
    print()

    user = input("小米账号: ").strip()
    if not user:
        print("账号不能为空")
        return

    # Use getpass to hide password input
    try:
        import msvcrt
        print("密码（输入不可见，输完回车）: ", end='', flush=True)
        pwd = ''
        while True:
            ch = msvcrt.getch()
            if ch == b'\r' or ch == b'\n':
                print()
                break
            elif ch == b'\x08':
                if pwd:
                    pwd = pwd[:-1]
            elif ch == b'\x03':
                print('^C')
                return
            else:
                try:
                    pwd += ch.decode('utf-8')
                except:
                    pass
    except ImportError:
        pwd = getpass("密码: ")

    if not pwd:
        print("密码不能为空")
        return

    print("\n[1] 正在登录小米云...")

    try:
        from micloud import MiCloud
        from micloud.micloudexception import MiCloudException

        mc = MiCloud(user, pwd)
        if not mc.login():
            print("\n❌ 登录失败")
            print("可能原因:")
            print("  1. 账号或密码错误")
            print("  2. 需要验证码 — 请在手机米家App中确认登录后重试")
            print("  3. 需要两步验证")
            return

        print("  ✓ 登录成功!")

        print("\n[2] 获取设备列表...")
        devices = mc.get_devices()

        if not devices:
            print("\n❌ 账号下没有找到设备")
            print("请确认设备已在米家App中绑定")
            return

        print(f"\n✅ 找到 {len(devices)} 个设备!\n")
        print("名称".ljust(16) + "IP地址".ljust(16) + "Token".ljust(34) + "型号")
        print("-" * 85)

        saved = []
        for d in devices:
            name = (d.get('name') or '?')[:14].ljust(14)
            ip = (d.get('localip') or '').ljust(14)
            token = (d.get('token') or '无')[:32].ljust(32)
            model = (d.get('model') or '?')[:20]
            print(f"{name} {ip} {token} {model}")

            saved.append({
                "name": d.get('name', ''),
                "model": d.get('model', ''),
                "ip": d.get('localip', ''),
                "token": d.get('token', ''),
                "did": d.get('did', ''),
                "mac": d.get('mac', ''),
            })

        # Save to mi_devices.json
        script_dir = os.path.dirname(os.path.abspath(__file__))
        save_path = os.path.join(script_dir, 'mi_devices.json')
        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(saved, f, ensure_ascii=False, indent=2)
        print(f"\n✅ 设备信息已保存到: {save_path}")

    except MiCloudException as e:
        print(f"\n❌ 小米云错误: {e}")
    except ImportError as e:
        print(f"\n❌ 缺少依赖: {e}")
        print("请运行: pip install micloud")
    except Exception as e:
        print(f"\n❌ 错误: {e}")

if __name__ == '__main__':
    main()
