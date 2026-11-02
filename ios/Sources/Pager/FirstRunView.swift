import SwiftUI

/// Before any pairing link has been opened: how to get one, and a field to paste it into.
struct FirstRunView: View {
    @EnvironmentObject private var model: AppModel
    @State private var link = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Pager")
                    .font(.system(size: 28, weight: .bold, design: .serif))
                Text("Pair this phone")
                    .font(.title2.weight(.semibold))
                Text("On your computer, open Pager, then Settings, then Phone, and choose Pair a phone. Scan the code it shows with the Camera, then choose Allow on the computer.")
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Or paste the link shown under the code")
                        .font(.subheadline.weight(.semibold))
                    TextField("pager://pair?…", text: $link, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(.footnote, design: .monospaced))
                        .padding(10)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 6))
                    Button("Open") {
                        if let url = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)) {
                            model.open(url)
                        } else {
                            model.linkError = "That isn't a link."
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let error = model.linkError {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.subheadline)
                }
                Button("Diagnostics") { model.showDiagnostics = true }
                    .font(.footnote)
            }
            .padding(.horizontal, 20)
            .padding(.top, 48)
            .frame(maxWidth: 440, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}
