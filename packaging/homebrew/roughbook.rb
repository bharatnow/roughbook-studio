# The Roughbook studio's standalone binary, for the tap bharatnow/homebrew-roughbook:
#
#   brew install bharatnow/roughbook/roughbook
#
# A template: `npm run binary -- --manifests` fills in the version and each archive's address and
# digest into release/manifests/homebrew/roughbook.rb, which is the file the tap holds.
class Roughbook < Formula
  desc "Design iterations inside your own repo, with the coding agent you already use"
  homepage "https://github.com/bharatnow/roughbook-studio"
  version "__VERSION__"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "__URL_DARWIN_ARM64__"
      sha256 "__SHA256_DARWIN_ARM64__"
    end
    on_intel do
      url "__URL_DARWIN_X64__"
      sha256 "__SHA256_DARWIN_X64__"
    end
  end

  on_linux do
    on_arm do
      url "__URL_LINUX_ARM64__"
      sha256 "__SHA256_LINUX_ARM64__"
    end
    on_intel do
      url "__URL_LINUX_X64__"
      sha256 "__SHA256_LINUX_X64__"
    end
  end

  def install
    bin.install "roughbook"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/roughbook --version")
  end
end
