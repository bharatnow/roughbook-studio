import SwiftUI

struct ProfileView: View {
    @AppStorage("name") private var name = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("You") {
                    TextField("Name", text: $name)
                }
                Section {
                    Toggle("Reminders", isOn: .constant(true))
                }
            }
            .navigationTitle("Profile")
        }
    }
}
