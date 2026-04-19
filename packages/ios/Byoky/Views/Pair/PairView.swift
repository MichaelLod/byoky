import SwiftUI
import AVFoundation
import Combine

struct PairView: View {
    @EnvironmentObject var wallet: WalletStore
    @StateObject private var pairService = RelayPairService()
    @State private var manualCode = ""
    @State private var showScanner = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        List {
            switch pairService.status {
            case .idle:
                idleSection
            case .connecting:
                connectingSection
            case .paired(let origin):
                pairedSection(origin: origin)
            case .error(let msg):
                errorSection(message: msg)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bgMain)
        .sheet(isPresented: $showScanner) {
            QRScannerView { code in
                showScanner = false
                connectWithCode(code)
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                pairService.reconnectIfNeeded()
            }
        }
        .onAppear {
            if let link = wallet.pendingPairLink {
                handlePairLink(link)
            }
        }
        .onChange(of: wallet.pendingPairLink) { _, newValue in
            if let link = newValue {
                handlePairLink(link)
            }
        }
    }

    private func handlePairLink(_ link: String) {
        connectWithCode(link)
        wallet.pendingPairLink = nil
    }

    private func stripPairPrefix(_ input: String) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefixes = [
            "byoky://pair/",
            "https://byoky.com/pair#",
            "https://byoky.com/pair/",
        ]
        for prefix in prefixes where trimmed.hasPrefix(prefix) {
            return String(trimmed.dropFirst(prefix.count))
        }
        return trimmed
    }

    private var idleSection: some View {
        SwiftUI.Group {
            Section {
                VStack(spacing: 16) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 48))
                        .foregroundStyle(Theme.accent)

                    Text("Pair with Web App")
                        .font(.headline)

                    Text("Scan the QR code shown on the web app, or paste the pairing code below. Your phone becomes the wallet — keys never leave this device. Keep the app open while using the web app.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    Button {
                        showScanner = true
                    } label: {
                        Label("Scan QR Code", systemImage: "camera.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                }
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
            }

            Section {
                TextField("Paste pairing code", text: $manualCode)
                    .fontDesign(.monospaced)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                Button("Connect") {
                    connectWithCode(manualCode)
                }
                .disabled(manualCode.isEmpty)
            } header: {
                Text("Manual Entry")
            } footer: {
                Text("Copy the pairing code from the web app and paste it here.")
            }
        }
    }

    private var connectingSection: some View {
        Section {
            VStack(spacing: 16) {
                CountdownRing(duration: 30)
                Text("Connecting to web app...")
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        }
    }

    private func pairedSection(origin: String) -> some View {
        SwiftUI.Group {
            Section {
                VStack(spacing: 16) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(Theme.success)

                    Text("Connected")
                        .font(.headline)

                    Text(origin)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
            }

            Section {
                HStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.title3)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Keep this app open")
                            .font(.subheadline.weight(.semibold))
                        Text("API calls are proxied through your phone. Locking your phone or switching apps will pause the connection.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 8)
            }

            Section {
                LabeledContent("Requests proxied", value: "\(pairService.requestCount)")
                LabeledContent("Credentials available", value: "\(wallet.credentials.count)")
            }

            Section {
                Button(role: .destructive) {
                    pairService.disconnect()
                } label: {
                    HStack {
                        Label("Disconnect", systemImage: "xmark.circle")
                        Spacer()
                    }
                }
            }
        }
    }

    private func errorSection(message: String) -> some View {
        Section {
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.orange)

                Text("Connection Failed")
                    .font(.headline)

                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button {
                    pairService.disconnect()
                } label: {
                    Text("Try Again")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            }
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
    }

    private func connectWithCode(_ code: String) {
        let cleaned = stripPairPrefix(code)
        guard let payload = PairPayload.decode(from: cleaned) else {
            pairService.status = .error("Invalid pairing code")
            return
        }
        pairService.connect(payload: payload, wallet: wallet)
    }
}

// MARK: - Countdown Ring

private struct CountdownRing: View {
    let duration: Double
    @State private var start = Date.now

    private var timer: some Publisher {
        Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
    }

    @State private var progress: Double = 1.0
    @State private var seconds: Int

    init(duration: Double) {
        self.duration = duration
        self._seconds = State(initialValue: Int(duration))
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.gray.opacity(0.2), lineWidth: 4)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(seconds)")
                .font(.title3.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .frame(width: 56, height: 56)
        .onReceive(Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()) { _ in
            let elapsed = Date.now.timeIntervalSince(start)
            let remaining = max(0, duration - elapsed)
            progress = remaining / duration
            seconds = Int(ceil(remaining))
        }
    }
}

// MARK: - QR Scanner

struct QRScannerView: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerController {
        let controller = QRScannerController()
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ uiViewController: QRScannerController, context: Context) {}
}

class QRScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var messageLabel: UILabel?
    private let sessionQueue = DispatchQueue(label: "com.byoky.qrscanner.session")
    private var found = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setupSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.setupSession() }
                    else { self?.showMessage("Camera access denied. Enable it in Settings to scan QR codes.") }
                }
            }
        default:
            showMessage("Camera access denied. Enable it in Settings to scan QR codes.")
        }
    }

    private func setupSession() {
        let session = AVCaptureSession()
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else {
            showMessage("Unable to access the camera.")
            return
        }

        guard session.canAddInput(input) else {
            showMessage("Unable to attach the camera.")
            return
        }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            showMessage("Unable to start QR detection.")
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.frame = view.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)

        captureSession = session
        previewLayer = preview

        // startRunning blocks — Apple warns it must not run on the main thread.
        sessionQueue.async { session.startRunning() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func showMessage(_ text: String) {
        if messageLabel == nil {
            let label = UILabel()
            label.textColor = .white
            label.numberOfLines = 0
            label.textAlignment = .center
            label.font = .systemFont(ofSize: 15, weight: .medium)
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
                label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
            ])
            messageLabel = label
        }
        messageLabel?.text = text
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !found,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let code = object.stringValue else { return }
        found = true
        if let session = captureSession {
            sessionQueue.async { session.stopRunning() }
        }
        onCode?(code)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if let session = captureSession {
            sessionQueue.async { session.stopRunning() }
        }
    }
}
