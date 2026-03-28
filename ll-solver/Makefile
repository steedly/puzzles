CXX      ?= g++
CXXFLAGS  = -O3 -std=c++17 -Wall -Wextra
LDFLAGS   =

# ── C++ standard library headers ─────────────────────────────────────────────
# On macOS, Apple Clang sometimes can't find C++ headers if the Command Line
# Tools are partially installed.  Detect this and add the SDK include path.
SDKROOT  := $(shell xcrun --show-sdk-path 2>/dev/null)
ifneq ($(SDKROOT),)
  SDK_CXX := $(SDKROOT)/usr/include/c++/v1
  ifeq ($(wildcard $(SDK_CXX)/algorithm),$(SDK_CXX)/algorithm)
    # Only apply the workaround if the default search path is broken
    CXX_TEST := $(shell echo '\#include <algorithm>' | $(CXX) -std=c++17 -E -x c++ - >/dev/null 2>&1; echo $$?)
    ifneq ($(CXX_TEST),0)
      CXXFLAGS += -nostdinc++ -isystem $(SDK_CXX)
    endif
  endif
endif

# ── OpenMP ───────────────────────────────────────────────────────────────────
# Linux / g++ — works out of the box:
#   make
#
# macOS / Apple Clang — requires libomp first:
#   brew install libomp
#   make OPENMP_PREFIX=$(brew --prefix libomp)
#
# Disable OpenMP entirely:
#   make NO_OPENMP=1

ifndef NO_OPENMP
  ifdef OPENMP_PREFIX
    # macOS with explicit libomp prefix
    CXXFLAGS += -Xpreprocessor -fopenmp -I$(OPENMP_PREFIX)/include
    LDFLAGS  += -L$(OPENMP_PREFIX)/lib -lomp
  else
    # Auto-detect libomp on macOS via brew
    BREW_OMP := $(shell brew --prefix libomp 2>/dev/null)
    ifneq ($(BREW_OMP),)
      CXXFLAGS += -Xpreprocessor -fopenmp -I$(BREW_OMP)/include
      LDFLAGS  += -L$(BREW_OMP)/lib -lomp
    else
      # Linux / gcc default
      CXXFLAGS += -fopenmp
    endif
  endif
endif

# ── Targets ──────────────────────────────────────────────────────────────────
.PHONY: all clean run test

all: enumerate

enumerate: enumerate.cpp
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)

test_enumerate: test_enumerate.cpp enumerate.cpp
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)

test_canonical: test_canonical.cpp
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)

# Full validation pipeline: unit tests + generate all variants + validate + D4 check
test: enumerate test_enumerate test_canonical
	@echo "=== Unit tests ==="
	./test_enumerate
	@echo ""
	@echo "=== Generating standard puzzles ==="
	./enumerate 1 6 1 20 > /tmp/puzzles_test.llp 2>/tmp/enumerate_test.log
	@cat /tmp/enumerate_test.log >&2
	@echo ""
	@echo "=== Validating standard ==="
	python3 validate_solutions.py /tmp/puzzles_test.llp
	./test_canonical < /tmp/puzzles_test.llp
	@echo ""
	@echo "=== Generating solitaire puzzles ==="
	./enumerate 1 6 1 20 solitaire > /tmp/puzzles_solitaire_test.llp 2>/tmp/sol_test.log
	@cat /tmp/sol_test.log >&2
	@echo ""
	@echo "=== Validating solitaire ==="
	python3 validate_solutions.py /tmp/puzzles_solitaire_test.llp
	./test_canonical < /tmp/puzzles_solitaire_test.llp
	@echo ""
	@echo "=== Generating UFO puzzles ==="
	./enumerate 1 6 1 20 ufo > /tmp/puzzles_ufo_test.llp 2>/tmp/ufo_test.log
	@cat /tmp/ufo_test.log >&2
	@echo ""
	@echo "=== Validating UFO ==="
	python3 validate_solutions.py /tmp/puzzles_ufo_test.llp
	./test_canonical < /tmp/puzzles_ufo_test.llp
	@echo ""
	@echo "=== Generating french puzzles ==="
	./enumerate 1 6 1 20 french > /tmp/puzzles_french_test.llp 2>/tmp/french_test.log
	@cat /tmp/french_test.log >&2
	@echo ""
	@echo "=== Validating french ==="
	python3 validate_solutions.py /tmp/puzzles_french_test.llp
	./test_canonical < /tmp/puzzles_french_test.llp
	@echo ""
	@echo "=== All tests passed ==="

# Quick smoke-test: only 1–2 helpers, moves 1–3
run: enumerate
	./enumerate 2 1 3

clean:
	rm -f enumerate test_enumerate test_canonical
