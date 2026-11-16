#!/usr/bin/env bash
# Serial Xyce 7.10 on macOS (Apple Silicon), no sudo: Trilinos 16.1 + Xyce from release tarballs, Homebrew deps.
#   brew install cmake suitesparse openblas fftw flex bison
#   PREFIX=~/.local/xyce JOBS=6 scripts/xyce-build.sh
# Result: $PREFIX/xyce/bin/Xyce. Logs in $PREFIX/logs.
set -euo pipefail
PREFIX=${PREFIX:-$HOME/.local/xyce}
JOBS=${JOBS:-6}
BREW=$(brew --prefix)
mkdir -p "$PREFIX"/{src,build,logs}
cd "$PREFIX/src"
[ -d Xyce ] || { mkdir Xyce; curl -fsSL https://github.com/Xyce/Xyce/archive/refs/tags/Release-7.10.0.tar.gz | tar xz -C Xyce --strip-components=1; }
[ -d Trilinos ] || { mkdir Trilinos; curl -fsSL https://github.com/trilinos/Trilinos/archive/refs/tags/trilinos-release-16-1-0.tar.gz | tar xz -C Trilinos --strip-components=1; }
# Apple clang 21 / libc++: AztecOO calls undeclared C functions (flag in the Trilinos configure below), and
# Xyce 7.10's explicit `std::abs<double>(x)` is ambiguous.
sed -i '' 's/std::abs<double>(/std::abs(/g' Xyce/src/LinearAlgebraServicesPKG/N_LAS_BlockSystemHelpers.C
blas=(-D BLAS_LIBRARY_DIRS="$BREW/opt/openblas/lib" -D BLAS_LIBRARY_NAMES=openblas -D LAPACK_LIBRARY_DIRS="$BREW/opt/openblas/lib" -D LAPACK_LIBRARY_NAMES=openblas)

if [ ! -f "$PREFIX/trilinos/lib/cmake/Trilinos/TrilinosConfig.cmake" ]; then
  mkdir -p "$PREFIX/build/trilinos"; cd "$PREFIX/build/trilinos"
  cmake -C "$PREFIX/src/Xyce/cmake/trilinos/trilinos-base.cmake" -D CMAKE_BUILD_TYPE=Release \
    -D CMAKE_C_COMPILER=clang -D CMAKE_CXX_COMPILER=clang++ -D Trilinos_ENABLE_Fortran=OFF -D CMAKE_C_FLAGS=-Wno-error=implicit-function-declaration \
    -D CMAKE_INSTALL_PREFIX="$PREFIX/trilinos" "${blas[@]}" \
    -D AMD_INCLUDE_DIRS="$BREW/include/suitesparse" -D AMD_LIBRARY_DIRS="$BREW/lib" \
    "$PREFIX/src/Trilinos" >"$PREFIX/logs/trilinos-cmake.log" 2>&1
  cmake --build . -j "$JOBS" -t install >"$PREFIX/logs/trilinos-build.log" 2>&1
fi

if [ ! -x "$PREFIX/xyce/bin/Xyce" ]; then
  mkdir -p "$PREFIX/build/xyce"; cd "$PREFIX/build/xyce"
  cmake -D CMAKE_BUILD_TYPE=Release -D CMAKE_C_COMPILER=clang -D CMAKE_CXX_COMPILER=clang++ \
    -D CMAKE_INSTALL_PREFIX="$PREFIX/xyce" -D Trilinos_ROOT="$PREFIX/trilinos" \
    -D CMAKE_PREFIX_PATH="$BREW/opt/flex;$BREW/opt/bison;$BREW" -D BISON_EXECUTABLE="$BREW/opt/bison/bin/bison" \
    -D FLEX_EXECUTABLE="$BREW/opt/flex/bin/flex" -D FLEX_INCLUDE_DIR="$BREW/opt/flex/include" \
    "$PREFIX/src/Xyce" >"$PREFIX/logs/xyce-cmake.log" 2>&1
  cmake --build . -j "$JOBS" -t install >"$PREFIX/logs/xyce-build.log" 2>&1
fi
"$PREFIX/xyce/bin/Xyce" -v
