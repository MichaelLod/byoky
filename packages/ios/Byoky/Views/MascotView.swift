import SwiftUI

/// Renders the Byoky logo from the bundled icon.
struct MascotView: View {
    var size: CGFloat = 120

    var body: some View {
        if let url = Bundle.main.url(forResource: "icon-128", withExtension: "png"),
           let data = try? Data(contentsOf: url),
           let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
        } else {
            Image(systemName: "key.fill")
                .font(.system(size: size * 0.5))
                .foregroundStyle(Theme.accent)
        }
    }
}
