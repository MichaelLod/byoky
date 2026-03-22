import SwiftUI
import AVFoundation

struct PairView: View {
    @EnvironmentObject var wallet: WalletStore
    @StateObject private var pairService = RelayPairService()
    @State private var manualCode = ""
    @State private var showScanner = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
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
            .navigationTitle("Pair")
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
        }
    }

    private var idleSection: some View {
        Group {
            Section {
                VStack(spacing: 16) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 48))
                        .foregroundStyle(Theme.accent)

                    Text("Pair with Web App")
                        .font(.headline)

                    Text("Scan the QR code shown on the web app, or paste the pairing code below. Your phone becomes the wallet — keys never leave this device.")
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
                ProgressView()
                    .scaleEffect(1.5)
                Text("Connecting to web app...")
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        }
    }

    private func pairedSection(origin: String) -> some View {
        Group {
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
            } footer: {
                Text("Keep this app open while using the web app. If you switch away, the connection will pause.")
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
        let cleaned = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let payload = PairPayload.decode(from: cleaned) else {
            pairService.status = .error("Invalid pairing code")
            return
        }
        pairService.connect(payload: payload, wallet: wallet)
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
    private var found = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let session = AVCaptureSession()
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else {
            return
        }

        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.frame = view.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)

        captureSession = session

        Task {
            session.startRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !found,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let code = object.stringValue else { return }
        found = true
        captureSession?.stopRunning()
        onCode?(code)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureSession?.stopRunning()
    }
}
