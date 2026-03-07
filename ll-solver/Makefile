CXX      ?= g++
CXXFLAGS  = -O3 -std=c++17 -Wall -Wextra
LDFLAGS   =

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
    # Linux / gcc default
    CXXFLAGS += -fopenmp
  endif
endif

# ── Targets ──────────────────────────────────────────────────────────────────
.PHONY: all clean run

all: enumerate

enumerate: enumerate.cpp
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)

# Quick smoke-test: only 1–2 helpers, moves 1–3
run: enumerate
	./enumerate 2 1 3

clean:
	rm -f enumerate
