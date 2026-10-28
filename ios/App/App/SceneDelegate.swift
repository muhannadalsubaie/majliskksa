import UIKit
import WebKit
import Capacitor

/// مع VoiceOver: السحب بثلاث أصابع يصل للعارض كطلب تمرير (accessibilityScroll) حين لا يكون في الصفحة
/// ما يُمرَّر في ذلك الاتجاه. نحوّله لنفس حدث إيماءة الإصبعين في أندرويد فتُقرأ نفس القراءات.
/// اتجاه الحدث = اتجاه حركة الأصابع: left = من اليمين لليسار، right = من اليسار لليمين، up = من تحت لفوق.
class MajliskWebView: WKWebView {
    override func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> Bool {
        let dir: String
        switch direction {
        case .left: dir = "left"
        case .right: dir = "right"
        case .up: dir = "up"
        case .down: dir = "down"
        default: return false
        }
        evaluateJavaScript("window.dispatchEvent(new CustomEvent('majlisk:two-finger',{detail:'\(dir)'}))", completionHandler: nil)
        return true
    }
}

class MajliskViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        return MajliskWebView(frame: frame, configuration: configuration)
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MajliskViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
